# UX rubric

The UX specialist judges every page and journey of the governance UI against these, at each viewport (desktop 1440,
laptop 1024, phone 390) and colour scheme. A failure of 1–4 is at least major; the rest are minor unless they block a
task. The people using it run a memory service for developers: they come to see what's been remembered, why, and to
remove what shouldn't be.

1. **It works without a mouse.** Every control is reachable in a sensible tab order, with a visible focus ring;
   dialogs and drawers trap focus and return it.
2. **It reads.** Text contrast meets WCAG AA on every background; nothing is clipped, overlapped or cut mid-word at
   any width. Memory text, which is long and arbitrary, wraps and can be shown in full.
3. **It says what's happening.** Loading, empty, error and success states exist and say what to do next; a list with
   nothing in it says so and why that might be (no sessions yet, a filter, a scope).
4. **It fits.** No sideways scroll; touch targets at least 44 px on phone; dense tables degrade to cards or a
   scrollable region of their own, never the page.
5. **Forgetting is deliberate and visible.** A forget shows what it will remove before it does, including the
   summaries it cascades to and how many; it asks once, plainly; what happened is in the audit afterwards. Nothing
   destructive is a single unlabelled icon.
6. **Provenance is one glance away.** Every memory shows its scope, its status, its trust and confidence, and where it
   came from (session, message, source) without leaving the list; a candidate looks different from an active one.
7. **Time is honest.** Times show both relative ("3 h ago") and absolute on hover or focus, in the viewer's zone; the
   memory text itself is never altered to add them (that's the frozen block's rule, and the UI shouldn't suggest
   otherwise).
8. **It's consistent.** The skeleton's components and tokens, not one-off styles; the same thing looks and behaves the
   same everywhere, in light and dark.
9. **It keeps people's data in its place.** Nothing from a memory or a session appears in a URL, a page title or a
   screenshot's visible chrome; secrets that slipped past redaction are shown masked, with a way to report and forget.
10. **It respects motion and data.** Reduced motion is honoured; pages stay usable on a slow phone; lists paginate.
