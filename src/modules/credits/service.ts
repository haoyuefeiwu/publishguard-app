import { and, asc, desc, eq, gt, gte, isNull, or, sql, sum } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';
import { credit, user } from '@/config/db/schema';
import { getSnowId, getUuid } from '@/lib/hash';

// --- Enums ---

export enum CreditStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  DELETED = 'deleted',
}

export enum CreditTransactionType {
  GRANT = 'grant',
  CONSUME = 'consume',
}

export enum CreditTransactionScene {
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
  RENEWAL = 'renewal',
  GIFT = 'gift',
  REWARD = 'reward',
}

type NewCredit = typeof credit.$inferInsert;

// --- Expiration ---

export function calculateCreditExpirationTime(params: {
  creditsValidDays: number;
  currentPeriodEnd?: Date;
}): Date | null {
  const { creditsValidDays, currentPeriodEnd } = params;

  if (!creditsValidDays || creditsValidDays <= 0) {
    return null; // never expires
  }

  if (currentPeriodEnd) {
    return new Date(currentPeriodEnd.getTime());
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + creditsValidDays);
  return expiresAt;
}

function validCreditConditions(userId: string) {
  const now = new Date();
  return and(
    eq(credit.userId, userId),
    eq(credit.transactionType, CreditTransactionType.GRANT),
    eq(credit.status, CreditStatus.ACTIVE),
    gt(credit.remainingCredits, 0),
    or(isNull(credit.expiresAt), gt(credit.expiresAt, now))
  );
}

// --- Balance ---

export async function getBalance(userId: string): Promise<number> {
  const [result] = await db()
    .select({ total: sum(credit.remainingCredits) })
    .from(credit)
    .where(validCreditConditions(userId));

  return parseInt(result?.total || '0');
}

// --- Grant ---

export async function grant(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  description?: string;
  orderNo?: string;
  subscriptionNo?: string;
  scene?: string;
  expiresAt?: Date | null;
}) {
  const newCredit: NewCredit = {
    id: getUuid(),
    userId: params.userId,
    userEmail: params.userEmail || '',
    transactionNo: getSnowId(),
    transactionType: CreditTransactionType.GRANT,
    transactionScene: params.scene || CreditTransactionScene.GIFT,
    credits: params.credits,
    remainingCredits: params.credits,
    status: CreditStatus.ACTIVE,
    description: params.description || 'Grant credit',
    orderNo: params.orderNo || '',
    subscriptionNo: params.subscriptionNo || '',
    expiresAt: params.expiresAt !== undefined ? params.expiresAt : null,
  };

  await db().insert(credit).values(newCredit);
  return newCredit;
}

// --- Consume (FIFO with batching) ---

export async function consume(params: {
  userId: string;
  userEmail?: string;
  credits: number;
  scene?: string;
  description?: string;
  metadata?: string;
  tx?: any;
}): Promise<{ success: boolean; consumedCredit?: any; balance?: number }> {
  const {
    userId,
    userEmail,
    credits: amount,
    scene,
    description,
    metadata,
    tx,
  } = params;
  const now = new Date();

  const execute = async (tx: any) => {
    // 1. Check balance
    const [balance] = await tx
      .select({ total: sum(credit.remainingCredits) })
      .from(credit)
      .where(
        and(
          eq(credit.userId, userId),
          eq(credit.transactionType, CreditTransactionType.GRANT),
          eq(credit.status, CreditStatus.ACTIVE),
          gt(credit.remainingCredits, 0),
          or(isNull(credit.expiresAt), gt(credit.expiresAt, now))
        )
      );

    if (!balance?.total || parseInt(balance.total, 10) < amount) {
      return { success: false, balance: parseInt(balance?.total || '0', 10) };
    }

    // 2. 按过期时间 FIFO 扣减，并对单条 grant 记录做原子余量防超扣校验
    let remainingToConsume = amount;
    const batchSize = 1000;
    const maxBatches = 10;
    let batchNo = 0;
    const consumedItems: any[] = [];

    while (remainingToConsume > 0 && batchNo < maxBatches) {
      const baseQuery = tx
        .select()
        .from(credit)
        .where(
          and(
            eq(credit.userId, userId),
            eq(credit.transactionType, CreditTransactionType.GRANT),
            eq(credit.status, CreditStatus.ACTIVE),
            gt(credit.remainingCredits, 0),
            or(isNull(credit.expiresAt), gt(credit.expiresAt, now))
          )
        )
        .orderBy(asc(credit.expiresAt))
        .limit(batchSize);

      const supportsRowLock = ['postgres', 'postgresql', 'mysql'].includes(
        (envConfigs.database_provider || '').toLowerCase()
      );
      const batchCredits = supportsRowLock
        ? await baseQuery.for('update')
        : await baseQuery;

      if (!batchCredits || batchCredits.length === 0) break;

      for (const item of batchCredits) {
        if (remainingToConsume <= 0) break;
        const toConsume = Math.min(remainingToConsume, item.remainingCredits);

        const [updatedGrant] = await tx
          .update(credit)
          .set({
            remainingCredits: sql`${credit.remainingCredits} - ${toConsume}`,
          })
          .where(
            and(eq(credit.id, item.id), gte(credit.remainingCredits, toConsume))
          )
          .returning();

        if (!updatedGrant) {
          throw new Error('Concurrent credit balance change detected');
        }

        consumedItems.push({
          creditId: item.id,
          transactionNo: item.transactionNo,
          creditsConsumed: toConsume,
          creditsBefore: item.remainingCredits,
          creditsAfter: updatedGrant.remainingCredits,
        });

        remainingToConsume -= toConsume;
      }

      batchNo++;
    }

    if (remainingToConsume > 0) {
      throw new Error('Failed to allocate sufficient credits in FIFO order');
    }

    // 3. Create consumption record
    const consumedCredit: NewCredit = {
      id: getUuid(),
      userId,
      userEmail: userEmail || '',
      transactionNo: getSnowId(),
      transactionType: CreditTransactionType.CONSUME,
      transactionScene: scene || '',
      status: CreditStatus.ACTIVE,
      description: description || '',
      credits: -amount,
      remainingCredits: 0,
      consumedDetail: JSON.stringify(consumedItems),
      metadata: metadata || '',
    };
    await tx.insert(credit).values(consumedCredit);

    return { success: true, consumedCredit };
  };

  if (tx) return execute(tx);
  return db().transaction(execute);
}

// --- Revoke (restore credits from a consumed record) ---

export async function revoke(consumeCreditId: string, tx?: any) {
  const execute = async (trx: any): Promise<boolean> => {
    // 先在事务内用条件更新抢占撤销资格，杜绝并发重复退款
    const [revokedRecord] = await trx
      .update(credit)
      .set({ status: CreditStatus.DELETED })
      .where(
        and(
          eq(credit.id, consumeCreditId),
          eq(credit.transactionType, CreditTransactionType.CONSUME),
          eq(credit.status, CreditStatus.ACTIVE)
        )
      )
      .returning();

    if (!revokedRecord || !revokedRecord.consumedDetail) return false;

    const items = JSON.parse(revokedRecord.consumedDetail);
    if (!Array.isArray(items) || items.length === 0) return false;

    // 原子逐笔回补原始赠分/充值批次余量
    for (const item of items) {
      const creditsConsumed = Number(item?.creditsConsumed || 0);
      if (!item?.creditId || creditsConsumed <= 0) continue;
      await trx
        .update(credit)
        .set({
          remainingCredits: sql`${credit.remainingCredits} + ${creditsConsumed}`,
        })
        .where(eq(credit.id, item.creditId));
    }

    return true;
  };

  if (tx) return execute(tx);
  return db().transaction(execute);
}

// --- Auto-grant for new user ---

export async function grantForNewUser(params: {
  userId: string;
  userEmail?: string;
  configs: Record<string, string>;
  clientIp?: string;
}) {
  const { userId, userEmail, configs, clientIp } = params;

  // 若后台尚未持久化配置，默认启用 30 积分新手礼（仅显式设为 false 时关闭）
  const enabled = configs.initial_credits_enabled ?? 'true';
  if (enabled !== 'true') return;

  const credits = parseInt(configs.initial_credits_amount ?? '30', 10) || 0;
  if (credits <= 0) return;

  // 同 IP 在 24 小时内最多允许领取 3 次新手试用积分，防止批量注册薅取体验金
  const normalizedIp = (clientIp || '').trim();
  const maxGrantsPerIp24h = Math.max(
    1,
    parseInt(configs.initial_credits_ip_limit ?? '3', 10) || 3
  );
  if (normalizedIp && normalizedIp !== '127.0.0.1' && normalizedIp !== '::1') {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentGiftGrants = await db()
      .select({ id: credit.id })
      .from(credit)
      .innerJoin(user, eq(credit.userId, user.id))
      .where(
        and(
          eq(user.ip, normalizedIp),
          eq(credit.transactionType, CreditTransactionType.GRANT),
          eq(credit.transactionScene, CreditTransactionScene.GIFT),
          gte(credit.createdAt, cutoff)
        )
      )
      .limit(maxGrantsPerIp24h);

    if (recentGiftGrants.length >= maxGrantsPerIp24h) {
      console.warn(
        `[credits] 触发同 IP 新手积分防刷限流: ip=${normalizedIp}, count=${recentGiftGrants.length}`
      );
      return null;
    }
  }

  const validDays =
    parseInt(configs.initial_credits_valid_days ?? '365', 10) || 0;
  const description =
    configs.initial_credits_description ||
    'Welcome 30 Trial Credits (PublishGuard)';

  const expiresAt = calculateCreditExpirationTime({
    creditsValidDays: validDays,
  });

  return grant({
    userId,
    userEmail,
    credits,
    description,
    scene: CreditTransactionScene.GIFT,
    expiresAt,
  });
}

// --- History ---

export async function getHistory(userId: string, limit = 50) {
  return db()
    .select()
    .from(credit)
    .where(and(eq(credit.userId, userId), isNull(credit.deletedAt)))
    .orderBy(desc(credit.createdAt))
    .limit(limit);
}
