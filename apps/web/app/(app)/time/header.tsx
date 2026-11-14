// The time page's header, shared by the page and its loading state so they match.
import { PageHeader } from "../page-header.tsx";

export function TimeHeader() {
  return (
    <PageHeader
      eyebrow="Time"
      title="Where engineering time goes"
      lede="Time lost to failed runs, re-runs and slow runs, by command and product. Measured on tools, never on people."
    />
  );
}
