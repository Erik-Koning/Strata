import { PageSkeleton } from "../../components/page-skeleton.tsx";

// Every page under the app shell shows this the moment a link is clicked, instead of waiting on its queries.
export default function Loading() {
  return <PageSkeleton />;
}
