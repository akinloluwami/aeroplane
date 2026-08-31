import { FieldLabel } from "../ui/primitives";
import { Dropdown } from "../ui/dropdown";

export function RepositoryBranchPicker({
  branch,
  branches,
  onChange
}: {
  branch: string;
  branches: string[];
  onChange: (branch: string) => void;
}) {
  const options = Array.from(new Set([branch, ...branches].filter(Boolean))).map((value) => ({
    value,
    label: value
  }));

  return (
    <div>
      <FieldLabel>Branch</FieldLabel>
      <Dropdown
        value={branch}
        options={options}
        onChange={onChange}
        placeholder="Select branch"
        variant="monochrome"
        size="compact"
        className="[&>button]:!h-9"
      />
    </div>
  );
}
