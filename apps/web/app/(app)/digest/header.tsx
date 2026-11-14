// The digest's header, shared by the page and its loading state so they match.
import { PageHeader } from "../page-header.tsx";

export function DigestHeader() {
  return (
    <PageHeader
      eyebrow="Digest"
      title="Weekly digest"
      lede="One week of approved work, product by product: what's new, what's in progress, the hours lost to tools, and the gaps opened and answered."
    />
  );
}
