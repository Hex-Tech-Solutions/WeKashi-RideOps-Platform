import { PageHeader } from "@/components/RoleLayout";
import { IssuesList } from "@/components/IssuesList";

export default function AdminIssues() {
  return (
    <div>
      <PageHeader title="Issues" description="All driver issues raised across the platform." />
      <IssuesList canResolve />
    </div>
  );
}
