/** Image-free, inline-styled email with a required plain-text alternative. */
export function hostedAuthCodeEmail(code: string) {
  if (!/^\d{6}$/u.test(code)) {
    throw new TypeError("Auth email requires a six-digit code.");
  }

  return {
    subject: "Your Murph sign-in code",
    text: `Your Murph sign-in code is ${code}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your Murph sign-in code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fffcf6;color:#2d3436;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your code is ready. It expires in 5 minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#fffcf6;">
      <tr>
        <td align="center" style="padding:48px 24px;">
          <!--[if mso]><table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
            <tr>
              <td style="padding-bottom:48px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:40px;font-weight:bold;letter-spacing:-1.5px;">Murph</td>
            </tr>
            <tr>
              <td>
                <h1 style="margin:0 0 20px;font-size:30px;line-height:38px;font-weight:600;letter-spacing:-0.6px;">Your sign-in code</h1>
                <p style="margin:0 0 28px;font-size:16px;line-height:26px;">Enter this code to continue to Murph.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px;background-color:#f5f0e8;border-radius:12px;font-family:'Courier New',Courier,monospace;font-size:36px;line-height:44px;font-weight:bold;letter-spacing:6px;">${code}</td>
            </tr>
            <tr>
              <td style="padding-top:20px;">
                <p style="margin:0;font-size:14px;line-height:22px;color:#736a58;">This code expires in 5 minutes.</p>
                <p style="margin:36px 0 0;font-size:14px;line-height:22px;color:#736a58;">If you didn't request a code, you can ignore this email.</p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
