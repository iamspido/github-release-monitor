"use client";

import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";

import { markdownSanitizeSchema } from "@/components/release-card-helpers";
import { remarkCommitLinks } from "@/components/remark-commit-links";
import type { CommitLink } from "@/types";

export function ReleaseNotesPreview({
  body,
  commitLinks,
}: {
  body?: string | null;
  commitLinks?: readonly CommitLink[];
}) {
  const t = useTranslations("ReleaseCard");

  if (!body || body.trim() === "") {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed">
        <p className="text-center text-sm text-muted-foreground">
          {t("no_release_notes")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-h-72 overflow-hidden rounded-md border bg-background">
      <div
        dir="auto"
        className="prose prose-sm dark:prose-invert max-w-none h-72 overflow-auto break-words p-4 prose-img:rounded prose-img:max-w-full prose-img:h-auto"
      >
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkGemoji,
            [remarkCommitLinks, { commitLinks }],
          ]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
          skipHtml={false}
          components={{
            table: ({ node, ...props }) => (
              <div className="overflow-x-auto">
                <table {...props} className="table-fixed">
                  {props.children}
                </table>
              </div>
            ),
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
