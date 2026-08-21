"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { normalizeRepositoryTag } from "@/lib/repositories/tags";
import { cn } from "@/lib/utils";

const LISTBOX_GAP = 4;
const LISTBOX_MAX_HEIGHT = 240;

interface ListboxLayout {
  bottom?: number;
  container: HTMLElement;
  left: number;
  maxHeight: number;
  strategy: "absolute" | "fixed";
  top?: number;
  width: number;
}

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
  const [listboxLayout, setListboxLayout] =
    React.useState<ListboxLayout | null>(null);
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

  React.useEffect(() => {
    if (!open || itemCount === 0) {
      setListboxLayout(null);
      return;
    }

    const updateListboxPosition = () => {
      const input = inputRef.current;
      if (!input) return;

      const rect = input.getBoundingClientRect();
      const dialog = input.closest<HTMLElement>('[role="dialog"]');
      const container = dialog ?? document.body;
      const containerRect = dialog?.getBoundingClientRect();
      const availableBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - LISTBOX_GAP,
      );
      const availableAbove = Math.max(0, rect.top - LISTBOX_GAP);
      const openAbove =
        availableBelow < LISTBOX_MAX_HEIGHT && availableAbove > availableBelow;
      const availableHeight = openAbove ? availableAbove : availableBelow;

      setListboxLayout({
        ...(openAbove
          ? {
              bottom:
                (containerRect?.bottom ?? window.innerHeight) -
                rect.top +
                LISTBOX_GAP,
            }
          : {
              top: rect.bottom - (containerRect?.top ?? 0) + LISTBOX_GAP,
            }),
        container,
        left: rect.left - (containerRect?.left ?? 0),
        maxHeight: Math.min(LISTBOX_MAX_HEIGHT, availableHeight),
        strategy: dialog ? "absolute" : "fixed",
        width: rect.width,
      });
    };

    updateListboxPosition();
    window.addEventListener("resize", updateListboxPosition);
    window.addEventListener("scroll", updateListboxPosition, true);

    return () => {
      window.removeEventListener("resize", updateListboxPosition);
      window.removeEventListener("scroll", updateListboxPosition, true);
    };
  }, [itemCount, open]);

  const keepInputFocused = (event: React.PointerEvent) => {
    event.preventDefault();
  };

  const focusInput = () => {
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (
        input &&
        (document.activeElement === input ||
          document.activeElement === document.body)
      ) {
        input.focus();
      }
    });
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
        dir="ltr"
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

      {open &&
        itemCount > 0 &&
        listboxLayout &&
        createPortal(
          <div
            id={listboxId}
            role="listbox"
            aria-label={listboxLabel}
            className={cn(
              "pointer-events-auto z-[60] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
              listboxLayout.strategy,
            )}
            style={{
              bottom: listboxLayout.bottom,
              left: listboxLayout.left,
              maxHeight: listboxLayout.maxHeight,
              top: listboxLayout.top,
              width: listboxLayout.width,
            }}
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
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-start text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeIndex === index && "bg-accent text-accent-foreground",
                )}
              >
                <Plus
                  aria-hidden="true"
                  data-tag-add-icon="true"
                  className="me-2 size-4 shrink-0"
                />
                <bdi dir="ltr" className="min-w-0 truncate">
                  {tag}
                </bdi>
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
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-start text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeIndex === filteredOptions.length &&
                    "bg-accent text-accent-foreground",
                )}
              >
                <Plus
                  aria-hidden="true"
                  data-tag-add-icon="true"
                  className="me-2 size-4 shrink-0"
                />
                <bdi dir="auto" className="min-w-0 truncate">
                  {createOptionLabel(createCandidate)}
                </bdi>
              </button>
            )}
          </div>,
          listboxLayout.container,
        )}
    </div>
  );
}
