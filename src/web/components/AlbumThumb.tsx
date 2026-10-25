import { useState } from "react";

import type { AlbumFolder } from "../../packages/model/types";
import { artUrl, imageUrl } from "../api-client";

export function AlbumThumb({
  album,
  size = "small",
}: {
  album: AlbumFolder;
  size?: "small" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const candidate =
    album.candidates.find((entry) => entry.release.id === album.selectedReleaseId) ??
    album.candidates[0];
  const overrideIndex = album.coverOverride
    ? album.images.findIndex((image) => image.path === album.coverOverride)
    : -1;

  let src: string | undefined;
  if (overrideIndex >= 0) src = artUrl(album.id, overrideIndex);
  else if (candidate?.release.coverImage || candidate?.release.thumb) {
    src = imageUrl(candidate.release.coverImage ?? candidate.release.thumb ?? "");
  } else if (album.images[0]) {
    src = artUrl(album.id, 0);
  }

  return (
    <div className={`album-thumb ${size}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="thumb-placeholder" aria-hidden="true">
          ♪
        </div>
      )}
    </div>
  );
}
