import { WorkspaceShell } from '@/components/workspace-shell';

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
