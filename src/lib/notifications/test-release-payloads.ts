import { getTranslations } from "next-intl/server";

// This constant holds the non-translatable part of the test data.
const jsCodeExample = `function greet(name) {
  // This long line tests horizontal scrolling
  console.log('Hello, ' + name + '! This line is very long to test horizontal scrolling, so it should definitely overflow the container and not wrap around.');
}

greet('World');`;

export async function getComprehensiveMarkdownBody(
  locale: string,
): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: "TestRelease" });

  const body = `# ${t("title")}

${t("body_intro")}

## ${t("section_text_formatting")}

- **${t("text_bold")}**
- *${t("text_italic")}*
- ***${t("text_bold_italic")}***
- ~~${t("text_strikethrough")}~~

> ${t("text_blockquote")}

---

## ${t("section_lists")}

### ${t("list_unordered_title")}
*   ${t("list_item_1")}
*   ${t("list_item_2")}
    *   ${t("list_nested_item_1")}
    *   ${t("list_nested_item_2")}

### ${t("list_unordered_variations_title")}
+ ${t("list_plus_item_1")}
+ ${t("list_plus_item_2")}
- ${t("list_hyphen_item_1")}
- ${t("list_hyphen_item_2")}

### ${t("list_ordered_title")}
1.  ${t("list_ordered_item_1")}
2.  ${t("list_ordered_item_2")}
3.  ${t("list_ordered_item_3")}
    1.  ${t("list_nested_ordered_1")}
    2.  ${t("list_nested_ordered_2")}

---

## ${t("section_emojis")}

${t("emojis_text")} ✨ 🚀 💡

---

## ${t("section_footnotes")}

${t("footnotes_text_1")}[^1]. ${t("footnotes_text_2")}[^2].

[^1]: ${t("footnote_1_definition")}
[^2]: ${t("footnote_2_definition")}

---

## ${t("section_links")}

${t("links_text_1")} [${t("links_text_2")}](https://www.markdownguide.org).

---

## ${t("section_code_blocks")}

### ${t("code_inline_title")}
${t("code_inline_text", {
  code: `\`${t("code_inline_code_word")}\``,
})}

### ${t("code_fenced_title")}
\`\`\`javascript
// ${t("code_fenced_js_comment")}
${jsCodeExample}
\`\`\`

---

## ${t("section_table")}

| ${t("table_header_feature")} | ${t("table_header_support")} | ${t("table_header_notes")} |
|-----------------|------------------|-------------------------------------|
| ${t("table_row1_feature")} | ${t("table_row1_support")} | ${t("table_row1_notes")} |
| ${t("table_row2_feature")} | ${t("table_row2_support")} | ${t("table_row2_notes")} |
| ${t("table_row3_feature")} | ${t("table_row3_support")} | ${t("table_row3_notes")} |
| ${t("table_row4_feature")} | ${t("table_row4_support")} | ${t("table_row4_notes")} |`;

  return {
    title: t("title"),
    body: body,
  };
}

export async function getBasicAppriseTestBody(
  locale: string,
): Promise<{ title: string; body: string }> {
  const t = await getTranslations({ locale, namespace: "TestRelease" });

  const body = `${t("apprise_basic_test_title")}

- ${t("apprise_basic_item_bold")}
- ${t("apprise_basic_item_italic")}
- ${t("apprise_basic_item_code")}

> ${t("apprise_basic_blockquote")}

${t("apprise_basic_link_text")} (https://github.com/iamspido/github-release-monitor)`;

  return {
    title: t("apprise_basic_test_notification_title"),
    body: body,
  };
}
