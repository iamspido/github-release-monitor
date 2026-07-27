interface ReleaseEmailHtmlTemplateData {
  buttonTextHtml: string;
  directionAttribute: string;
  introHtml: string;
  listDateLabelHtml: string;
  listNameLabelHtml: string;
  listVersionLabelHtml: string;
  localeAttribute: string;
  notesTitleHtml: string;
  releaseBodyHtml: string;
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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
          color: #c9d1d9;
          line-height: 1.6;
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
        }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 85%;
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
          padding-left: 16px;
          color: #8b949e;
          margin: 0 0 16px;
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
      </style>
    </head>
    <body>
      <div class="container">
        <h2>${data.titleHtml}</h2>
        <p>${data.introHtml}</p>
        <ul style="padding-left: 20px; margin-top: 16px; margin-bottom: 24px;">
          <li><strong style="color: #fafafa;">${data.listVersionLabelHtml}</strong> ${data.releaseTagNameHtml}</li>
          <li><strong style="color: #fafafa;">${data.listNameLabelHtml}</strong> ${data.releaseNameHtml}</li>
          <li><strong style="color: #fafafa;">${data.listDateLabelHtml}</strong> ${data.releaseDateHtml}</li>
        </ul>
        <h3>${data.notesTitleHtml}</h3>
        <div class="release-notes-container">
          ${data.releaseBodyHtml}
        </div>
        <p style="margin-top: 24px;">
          <a href="${data.releaseUrlAttribute}" class="button">
            ${data.buttonTextHtml}
          </a>
        </p>
      </div>
    </body>
    </html>
  `;
}
