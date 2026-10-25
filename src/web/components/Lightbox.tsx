import { useEffect } from "react";

export function Lightbox({
  src,
  caption,
  onClose,
}: {
  src: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop lightbox" onMouseDown={onClose} role="presentation">
      <figure onMouseDown={(event) => event.stopPropagation()}>
        <img src={src} alt={caption ?? "Album art"} />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    </div>
  );
}
