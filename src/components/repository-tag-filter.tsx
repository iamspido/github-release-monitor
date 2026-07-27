"use client";

import { Tags, X } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { normalizeRepositoryTag } from "@/lib/repositories/tags";

export interface RepositoryTagOption {
  tag: string;
  count: number;
}

interface RepositoryTagFilterProps {
  options: RepositoryTagOption[];
  untaggedCount: number;
  selectedTags: ReadonlySet<string>;
  includeUntagged: boolean;
  onTagToggle: (tag: string) => void;
  onUntaggedToggle: () => void;
  onClear: () => void;
}

export function RepositoryTagFilter({
  options,
  untaggedCount,
  selectedTags,
  includeUntagged,
  onTagToggle,
  onUntaggedToggle,
  onClear,
}: RepositoryTagFilterProps) {
  const t = useTranslations("HomePage");
  const [search, setSearch] = React.useState("");
  const activeCount = selectedTags.size + (includeUntagged ? 1 : 0);
  const normalizedSearch = normalizeRepositoryTag(search);
  const filteredOptions = normalizedSearch
    ? options.filter(({ tag }) => tag.includes(normalizedSearch))
    : options;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full sm:w-auto">
          <Tags className="size-4" />
          <span>
            {activeCount > 0
              ? t("tag_filter_active", { count: activeCount })
              : t("tag_filter_label")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("tag_filter_title")}</DropdownMenuLabel>
        {options.length > 0 && (
          <div className="px-2 pb-2">
            <Input
              dir="ltr"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
              placeholder={t("tag_filter_search_placeholder")}
              className="h-8"
              aria-label={t("tag_filter_search_aria")}
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {filteredOptions.map(({ tag, count }) => (
            <DropdownMenuCheckboxItem
              key={tag}
              checked={selectedTags.has(tag)}
              onCheckedChange={() => onTagToggle(tag)}
              onSelect={(event) => event.preventDefault()}
            >
              <bdi dir="ltr" className="min-w-0 flex-1 truncate">
                {tag}
              </bdi>
              <span className="ms-3 text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {filteredOptions.length === 0 && options.length > 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("tag_filter_no_matches")}
            </p>
          )}
          {untaggedCount > 0 && !normalizedSearch && (
            <DropdownMenuCheckboxItem
              checked={includeUntagged}
              onCheckedChange={onUntaggedToggle}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 flex-1 truncate">
                {t("tag_filter_untagged")}
              </span>
              <span className="ms-3 text-xs tabular-nums text-muted-foreground">
                {untaggedCount}
              </span>
            </DropdownMenuCheckboxItem>
          )}
        </div>
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>
              <X className="me-2 size-4" />
              {t("tag_filter_clear")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
