'use client';

import { cn } from '@/lib/utils';

type CoverThumbnailProps = {
  themeId: string;
  title: string;
  authorName: string;
  editionLabel?: string;
  className?: string;
};

/**
 * 在前端以真实书籍版式骨架预览 4 套去同质化封面缩略图，
 * 与 worker/cover_templates.py 实际印刷封面保持同一套色板与结构层级。
 */
export function KdpCoverThumbnail({
  themeId,
  title,
  authorName,
  editionLabel = 'INDEPENDENT EDITION',
  className,
}: CoverThumbnailProps) {
  const safeTitle = title.trim() || 'Quiet Cadence Monograph';
  const safeAuthor = authorName.trim() || 'Evelyn Vance';

  if (themeId === 'asymmetric_hbr') {
    return (
      <div
        className={cn(
          'relative flex aspect-[5/8] w-full overflow-hidden rounded-md border border-black/15 bg-[#141A24] text-[#F4F6F9] shadow-sm select-none',
          className
        )}
      >
        <div className="h-full w-[12%] shrink-0 bg-[#8C2D2D]" />
        <div className="flex flex-1 flex-col justify-between p-2.5">
          <div>
            <div className="truncate text-[6px] font-bold tracking-[0.18em] text-[#E6B86A] uppercase">
              {editionLabel}
            </div>
            <div className="mt-1.5 line-clamp-3 font-sans text-[10px] leading-[1.12] font-bold">
              {safeTitle}
            </div>
            <div className="mt-1.5 h-[2px] w-4 bg-[#E6B86A]" />
          </div>
          <div className="truncate border-t border-white/20 pt-1 text-[7px] font-semibold tracking-[0.14em] text-white uppercase">
            {safeAuthor}
          </div>
        </div>
      </div>
    );
  }

  if (themeId === 'ivory_monograph') {
    return (
      <div
        className={cn(
          'relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-md border border-stone-300 bg-[#F4EFE6] p-2.5 text-[#1D1B18] shadow-sm select-none',
          className
        )}
      >
        <div className="flex justify-between border-y border-[#2C352E] py-0.5 text-[5px] font-semibold tracking-[0.14em] text-[#2C352E] uppercase">
          <span className="truncate">MONOGRAPH</span>
          <span>ORIGINAL</span>
        </div>
        <div className="px-1 text-center">
          <div className="line-clamp-3 font-serif text-[10px] leading-[1.15] font-bold">
            {safeTitle}
          </div>
          <div className="mx-auto my-1.5 h-[1.5px] w-4 bg-[#7A4E2D]" />
          <div className="text-[6px] text-[#625B50] italic">
            Field Monograph
          </div>
        </div>
        <div className="truncate border-t border-[#D3C9BA] pt-1 text-center font-serif text-[7px] font-bold tracking-wider">
          {safeAuthor}
        </div>
      </div>
    );
  }

  if (themeId === 'minimal_architectural') {
    return (
      <div
        className={cn(
          'relative flex aspect-[5/8] w-full flex-col justify-between overflow-hidden rounded-md border border-slate-700 bg-[#0F172A] p-2.5 text-[#F1F5F9] shadow-sm select-none',
          className
        )}
      >
        <div className="flex items-center gap-1">
          <div className="size-1.5 bg-[#38BDF8]" />
          <span className="truncate text-[5.5px] font-bold tracking-[0.18em] text-[#38BDF8] uppercase">
            {editionLabel}
          </span>
        </div>
        <div className="border-l-2 border-[#38BDF8] pl-2">
          <div className="line-clamp-3 font-sans text-[9.5px] leading-[1.14] font-bold">
            {safeTitle}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-slate-600/40 pt-1 text-[6.5px]">
          <span className="truncate font-semibold tracking-[0.12em] uppercase">
            {safeAuthor}
          </span>
          <span className="font-mono text-[5.5px] text-[#38BDF8]">ED.</span>
        </div>
      </div>
    );
  }

  // editorial_split (默认)
  return (
    <div
      className={cn(
        'relative flex aspect-[5/8] w-full flex-col overflow-hidden rounded-md border border-stone-300 bg-[#FAF7F2] text-[#182026] shadow-sm select-none',
        className
      )}
    >
      <div className="flex basis-[58%] flex-col justify-between bg-[#1E2D3B] p-2.5 text-[#F8F5EF]">
        <div className="truncate text-[5.5px] font-bold tracking-[0.18em] text-[#C97A40] uppercase">
          {editionLabel}
        </div>
        <div className="line-clamp-3 font-serif text-[10px] leading-[1.14] font-bold">
          {safeTitle}
        </div>
        <div className="h-[2px] w-5 bg-[#C97A40]" />
      </div>
      <div className="flex flex-1 flex-col justify-end p-2.5">
        <div className="truncate border-t border-[#D9D2C7] pt-1 text-[7px] font-bold tracking-[0.1em] text-[#182026] uppercase">
          {safeAuthor}
        </div>
      </div>
    </div>
  );
}
