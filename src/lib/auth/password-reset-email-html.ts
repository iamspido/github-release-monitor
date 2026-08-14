interface PasswordResetEmailHtmlData {
  actionUrlAttribute: string;
  buttonTextHtml: string;
  directionAttribute: string;
  expiryNoticeHtml: string;
  ignoreNoticeHtml: string;
  introHtml: string;
  localeAttribute: string;
  subjectHtml: string;
  titleHtml: string;
}

export function renderPasswordResetEmailHtml(
  data: PasswordResetEmailHtmlData,
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
        h2 {
          color: #fafafa;
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
        }
        p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        a {
          color: #8c9fe8;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
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
        .notice-container {
          background-color: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 16px;
          margin-top: 24px;
        }
        .notice-container p:last-child {
          margin-bottom: 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>${data.titleHtml}</h2>
        <p>${data.introHtml}</p>
        <p style="margin-top: 24px;">
          <a href="${data.actionUrlAttribute}" class="button">${data.buttonTextHtml}</a>
        </p>
        <div class="notice-container">
          <p>${data.expiryNoticeHtml}</p>
          <p>${data.ignoreNoticeHtml}</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
