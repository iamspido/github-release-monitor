"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { normalizeRepositoryTag } from "@/lib/repositories/tags";
import { cn } from "@/lib/utils";

interface RepositoryTagPickerProps {
  id: string;
  options: readonly string[];
  selectedTags: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
  onTagSelect: (tag: string) => boolean;
  onCreateTag: (tag: string) => boolean;
  onInputBlur: () => void;
  placeholder: string;
  listboxLabel: string;
  createOptionLabel: (tag: string) => string;
  ariaLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}

export function RepositoryTagPicker({
  id,
  options,
  selectedTags,
  value,
  onValueChange,
  onTagSelect,
  onCreateTag,
  onInputBlur,
  placeholder,
  listboxLabel,
  createOptionLabel,
  ariaLabel,
  disabled = false,
  invalid = false,
}: RepositoryTagPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();
  const normalizedValue = normalizeRepositoryTag(value);
  const isAlreadySelected = selectedTags.some(
    (tag) => normalizeRepositoryTag(tag) === normalizedValue,
  );
  const filteredOptions = normalizedValue
    ? options.filter((tag) => tag.toLowerCase().includes(normalizedValue))
    : options;
  const createCandidate =
    normalizedValue.length > 0 &&
    filteredOptions.length === 0 &&
    !isAlreadySelected
      ? value.trim()
      : null;
  const itemCount = filteredOptions.length + (createCandidate ? 1 : 0);

  const keepInputFocused = (event: React.PointerEvent) => {
    event.preventDefault();
  };

  const focusInput = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const selectTag = (tag: string) => {
    if (!onTagSelect(tag)) return;
    onValueChange("");
    setActiveIndex(-1);
    focusInput();
  };

  const createTag = () => {
    if (!createCandidate || !onCreateTag(createCandidate)) return;
    onValueChange("");
    setActiveIndex(-1);
    focusInput();
  };

  const activeDescendant =
    activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open && itemCount > 0}
        aria-activedescendant={activeDescendant}
        aria-invalid={invalid}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              itemCount === 0 ? -1 : Math.min(current + 1, itemCount - 1),
            );
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              itemCount === 0 ? -1 : current <= 0 ? itemCount - 1 : current - 1,
            );
            return;
          }

          if (event.key === "Enter") {
            const canSelectActiveOption =
              activeIndex >= 0 && activeIndex < itemCount;
            if (!canSelectActiveOption && !normalizedValue) return;

            event.preventDefault();
            if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
              selectTag(filteredOptions[activeIndex]);
            } else if (
              activeIndex === filteredOptions.length &&
              createCandidate
            ) {
              createTag();
            } else if (filteredOptions[0]) {
              selectTag(filteredOptions[0]);
            } else {
              createTag();
            }
            return;
          }

          if (event.key === "Escape") {
            if (open && itemCount > 0) {
              event.stopPropagation();
              setOpen(false);
              setActiveIndex(-1);
            }
          }
        }}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
          if (createCandidate) onInputBlur();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          invalid && "border-destructive focus-visible:ring-destructive",
        )}
      />

      {open && itemCount > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={listboxLabel}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filteredOptions.map((tag, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              key={tag}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === index}
              onPointerDown={keepInputFocused}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectTag(tag)}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground",
                activeIndex === index && "bg-accent text-accent-foreground",
              )}
            >
              <Plus
                aria-hidden="true"
                data-tag-add-icon="true"
                className="mr-2 size-4 shrink-0"
              />
              <span className="min-w-0 truncate">{tag}</span>
            </button>
          ))}
          {createCandidate && (
            <button
              id={`${listboxId}-option-${filteredOptions.length}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === filteredOptions.length}
              onPointerDown={keepInputFocused}
              onMouseEnter={() => setActiveIndex(filteredOptions.length)}
              onClick={createTag}
              className={cn(
                "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground",
                activeIndex === filteredOptions.length &&
                  "bg-accent text-accent-foreground",
              )}
            >
              <Plus
                aria-hidden="true"
                data-tag-add-icon="true"
                className="mr-2 size-4 shrink-0"
              />
              <span className="min-w-0 truncate">
                {createOptionLabel(createCandidate)}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
