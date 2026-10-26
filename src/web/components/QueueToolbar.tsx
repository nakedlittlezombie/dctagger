import { useMemo } from "react";

import type { AlbumFolder } from "../../packages/model/types";
import { missingTrackCount } from "../album-stats";
import {
  QUEUE_FILTERS,
  QUEUE_SORTS,
  queueCounts,
  type QueueFilter,
  type QueueOptions,
  type QueueSort,
} from "../album-queue";

interface QueueToolbarProps {
  albums: AlbumFolder[];
  options: QueueOptions;
  onChange: (patch: Partial<QueueOptions>) => void;
  /** Optional note next to the controls, e.g. how many albums the queue holds. */
  summary?: string;
}

/**
 * Status filter, missing-track filter, sort, and search for the album queue.
 * Shared by the library list and the match queue so both read one set of
 * options and the queue progresses in the order shown.
 */
export function QueueToolbar({ albums, options, onChange, summary }: QueueToolbarProps) {
  const counts = useMemo(() => queueCounts(albums), [albums]);
  const missingCount = useMemo(
    () => albums.filter((album) => missingTrackCount(album) > 0).length,
    [albums],
  );

  const setFilter = (filter: QueueFilter) => onChange({ filter });
  const setSort = (sort: QueueSort) => onChange({ sort });

  return (
    <div className="toolbar queue-toolbar">
      <div className="filter-tabs">
        {QUEUE_FILTERS.map((entry) => (
          <button
            key={entry.id}
            className={options.filter === entry.id ? "filter-tab active" : "filter-tab"}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <span className="filter-count">{counts[entry.id]}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-options">
        {summary && <span className="muted tiny queue-summary">{summary}</span>}
        <button
          className={options.hideMissing ? "filter-tab active" : "filter-tab"}
          aria-pressed={options.hideMissing}
          title={
            options.hideMissing
              ? "Showing only albums with every release track present"
              : "Hide albums where the selected release has tracks with no local file"
          }
          onClick={() => onChange({ hideMissing: !options.hideMissing })}
        >
          Hide missing tracks
          <span className="filter-count">{missingCount}</span>
        </button>
        <label className="sort-select">
          <span className="muted tiny">Sort</span>
          <select
            value={options.sort}
            onChange={(event) => setSort(event.target.value as QueueSort)}
            aria-label="Sort albums"
          >
            {QUEUE_SORTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <input
          className="search-input"
          value={options.query}
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Filter albums…"
          aria-label="Filter albums"
        />
      </div>
    </div>
  );
}
