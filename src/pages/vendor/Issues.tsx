import { PageHeader } from "@/components/RoleLayout";
import { IssuesList } from "@/components/IssuesList";

export default function VendorIssues() {
  return (
    <div>
      <PageHeader title="Issues" description="Issues raised by supervisors about your drivers. You can view and add comments only." />
      <IssuesList canResolve={false} />
    </div>
  );
}
