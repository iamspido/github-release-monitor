interface ReleaseEmailHtmlTemplateData {
  buttonTextHtml: string;
  directionAttribute: string;
  introHtml: string;
  listDateLabelHtml: string;
  listNameLabelHtml: string;
  listVersionLabelHtml: string;
  localeAttribute: string;
  monitorButtonTextHtml?: string;
  monitorUrlAttribute?: string;
  notesTitleHtml: string;
  releaseBodyHtml?: string;
  releaseDateHtml: string;
  releaseNameHtml: string;
  releaseTagNameHtml: string;
  releaseUrlAttribute: string;
  subjectHtml: string;
  titleHtml: string;
}

export function renderReleaseEmailHtml(
  data: ReleaseEmailHtmlTemplateData,
): string {
  return `
    <!DOCTYPE html>
    <html lang="${data.localeAttribute}" dir="${data.directionAttribute}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <title>${data.subjectHtml}</title>
      <style>
        :root {
          color-scheme: dark;
        }
        body {
          margin: 0;
          padding: 0;
          width: 100%;
          background-color: #0d1117;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
          color: #c9d1d9;
          line-height: 1.6;
        }
        html[dir="rtl"] body {
          text-align: right;
        }
        .container {
          background-color: #101928;
          padding: 20px;
          max-width: 680px;
          margin: 20px auto;
          border-radius: 8px;
          border: 1px solid #30363d;
        }
        .release-notes-container {
          background-color: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 1px 16px;
          unicode-bidi: plaintext;
        }
        h1, h2, h3, h4, h5, h6 {
          color: #fafafa;
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
        }
        p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        ul, ol {
          margin-top: 0;
          margin-bottom: 16px;
          padding-left: 2em;
          padding-right: 0;
        }
        html[dir="rtl"] ul,
        html[dir="rtl"] ol {
          padding-left: 0;
          padding-right: 2em;
        }
        li {
          margin-bottom: 4px;
        }
        a {
          color: #8c9fe8;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        pre {
          display: block;
          background-color: #161b22;
          color: #c9d1d9;
          padding: 16px;
          margin: 16px 0;
          border-radius: 6px;
          overflow-x: auto;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 14px;
          line-height: 1.45;
          word-break: normal;
          word-wrap: normal;
          direction: ltr;
          text-align: left;
        }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 85%;
          direction: ltr;
          unicode-bidi: isolate;
        }
        pre code {
          background-color: transparent;
          padding: 0;
          margin: 0;
          border-radius: 0;
        }
        code:not(pre code) {
           background-color: #30363d;
           padding: 0.2em 0.4em;
           margin: 0;
           border-radius: 6px;
           word-break: break-all;
        }
        blockquote {
          border-left: 4px solid #30363d;
          border-right: 0;
          padding-left: 16px;
          padding-right: 0;
          color: #8b949e;
          margin: 0 0 16px;
        }
        html[dir="rtl"] blockquote {
          border-left: 0;
          border-right: 4px solid #30363d;
          padding-left: 0;
          padding-right: 16px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          border-spacing: 0;
          display: block;
          overflow: auto;
        }
        th, td {
          padding: 6px 13px;
          border: 1px solid #30363d;
        }
        tr {
          background-color: transparent;
          border-top: 1px solid #30363d;
        }
        hr {
          border: 0;
          border-top: 1px solid #30363d;
          margin: 24px 0;
        }
        .button {
          display: inline-block;
          background-color: #24292f;
          color: #ffffff;
          padding: 10px 20px;
          text-decoration: none;
          border-radius: 5px;
          font-weight: 500;
        }
        .details-list {
          padding-left: 20px;
          padding-right: 0;
          margin-top: 16px;
          margin-bottom: 24px;
        }
        html[dir="rtl"] .details-list {
          padding-left: 0;
          padding-right: 20px;
        }
        .technical-value {
          direction: ltr;
          unicode-bidi: isolate;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2><bdi dir="auto">${data.titleHtml}</bdi></h2>
        <p>${data.introHtml}</p>
        <ul class="details-list">
          <li><strong style="color: #fafafa;">${data.listVersionLabelHtml}</strong> <bdi dir="ltr" class="technical-value" style="direction: ltr; unicode-bidi: isolate;">${data.releaseTagNameHtml}</bdi></li>
          <li><strong style="color: #fafafa;">${data.listNameLabelHtml}</strong> <bdi dir="auto">${data.releaseNameHtml}</bdi></li>
          <li><strong style="color: #fafafa;">${data.listDateLabelHtml}</strong> <bdi dir="auto">${data.releaseDateHtml}</bdi></li>
        </ul>
        ${
          data.releaseBodyHtml === undefined
            ? ""
            : `<h3>${data.notesTitleHtml}</h3>
        <div class="release-notes-container" dir="auto">
          ${data.releaseBodyHtml}
        </div>`
        }
        <p style="margin-top: 24px;">
          <a href="${data.releaseUrlAttribute}" class="button">
            ${data.buttonTextHtml}
          </a>
          ${
            data.monitorButtonTextHtml && data.monitorUrlAttribute
              ? `<a href="${data.monitorUrlAttribute}" class="button" style="margin-inline-start: 8px;">
            ${data.monitorButtonTextHtml}
          </a>`
              : ""
          }
        </p>
      </div>
    </body>
    </html>
  `;
}

interface ReleaseDigestEmailHtmlTemplateData {
  directionAttribute: string;
  entriesHtml: string;
  introHtml: string;
  localeAttribute: string;
  monitorButtonTextHtml?: string;
  monitorUrlAttribute?: string;
  subjectHtml: string;
}

export function renderReleaseDigestEmailHtml(
  data: ReleaseDigestEmailHtmlTemplateData,
): string {
  return `
    <!DOCTYPE html>
    <html lang="${data.localeAttribute}" dir="${data.directionAttribute}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
      <title>${data.subjectHtml}</title>
      <style>
        :root { color-scheme: dark; }
        body { margin: 0; padding: 0; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif; line-height: 1.6; }
        html[dir="rtl"] body { text-align: right; }
        .container { background: #101928; padding: 20px; max-width: 680px; margin: 20px auto; border: 1px solid #30363d; border-radius: 8px; }
        .release { border-top: 1px solid #30363d; margin-top: 24px; padding-top: 8px; }
        .notes { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 1px 16px; unicode-bidi: plaintext; }
        h1, h2, h3, h4, h5, h6 { color: #fafafa; margin-top: 24px; margin-bottom: 16px; }
        a { color: #8c9fe8; text-decoration: none; }
        ul, ol { padding-inline-start: 2em; }
        pre { display: block; background: #161b22; padding: 16px; overflow-x: auto; direction: ltr; text-align: left; }
        code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; direction: ltr; unicode-bidi: isolate; }
        blockquote { border-inline-start: 4px solid #30363d; padding-inline-start: 16px; color: #8b949e; }
        .button { display: inline-block; background: #24292f; color: #fff; padding: 10px 20px; border-radius: 5px; font-weight: 500; }
        .technical-value { direction: ltr; unicode-bidi: isolate; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2><bdi dir="auto">${data.subjectHtml}</bdi></h2>
        <p>${data.introHtml}</p>
        ${data.entriesHtml}
        ${
          data.monitorButtonTextHtml && data.monitorUrlAttribute
            ? `<p style="margin-top: 24px;"><a href="${data.monitorUrlAttribute}" class="button">${data.monitorButtonTextHtml}</a></p>`
            : ""
        }
      </div>
    </body>
    </html>
  `;
}
