"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchSelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  blankLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search people",
  blankLabel,
  disabled,
  className,
}: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? options.filter((option) =>
          `${option.label} ${option.hint || ""} ${option.value}`
            .toLowerCase()
            .includes(needle)
        )
      : options;
    return rows.slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={`relative ${className || ""}`}>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : selected?.label || ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="w-full rounded-lg border border-line px-3 py-2 text-sm disabled:bg-wash"
      />
      {open ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-soft"
        >
          {blankLabel != null ? (
            <li>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-ink-soft hover:bg-wash/70"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose("")}
              >
                {blankLabel}
              </button>
            </li>
          ) : null}
          {filtered.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-wash/70 ${
                  option.value === value
                    ? "bg-wash/50 font-semibold text-ink"
                    : "text-ink"
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span className="block">{option.label}</span>
                {option.hint ? (
                  <span className="block text-xs font-normal text-ink-soft">
                    {option.hint}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          {!filtered.length ? (
            <li className="px-3 py-2 text-sm text-ink-soft">No matches</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
