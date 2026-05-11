/**
 * App-wide branding watermark — the Sahayak lantern, faintly painted
 * behind every page. Most visible on the new-chat empty state where
 * the surface is otherwise sparse, so it doubles as the empty-state
 * hero. Uses two PNGs (light + dark) swapped via the `dark:` variant
 * so the lantern reads correctly on both themes.
 *
 * Fixed-positioned and pointer-events-none so it never interferes
 * with layout or input. Sits in document order before the page tree
 * so children paint on top.
 */
export function Watermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center"
    >
      <img
        src="/sahayak-logo.png"
        alt=""
        draggable={false}
        className="watermark-img watermark-img-light block h-[60vh] max-h-[560px] w-auto select-none dark:hidden"
      />
      <img
        src="/sahayak-logo-dark.png"
        alt=""
        draggable={false}
        className="watermark-img watermark-img-dark hidden h-[60vh] max-h-[560px] w-auto select-none dark:block"
      />
    </div>
  );
}
