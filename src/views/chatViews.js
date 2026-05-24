/**
 * HTML for the conversational planner shell (SSR).
 *
 * @param {{ role: string, text: string }[]} opts.messages
 * @param {{ title: string, startLocal: string, endLocal: string }[] | null} opts.previewRows
 */

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderChatBubble(row) {
  if (row.role === "assistant") {
    return `<div class="chat-row assistant" role="group" aria-label="Assistant">
  <img class="avatar" src="/assistant.svg" alt="" width="44" height="44" decoding="async" />
  <div class="bubble assistant-bubble">${escapeHtml(row.text).replaceAll("\n", "<br />")}</div>
</div>`;
  }

  return `<div class="chat-row user"><div class="bubble user-bubble">${escapeHtml(row.text).replaceAll("\n", "<br />")}</div></div>`;
}

function renderPreviewCard(rows) {
  if (!rows || rows.length === 0) return "";
  let table = `<div class="preview-card"><h3 class="preview-h">Draft on your calendar</h3>`;
  table += `<table class="preview-table"><thead><tr><th>When (local)</th><th>Block</th></tr></thead><tbody>`;
  for (const r of rows) {
    table += `<tr><td>${escapeHtml(r.startLocal)} – ${escapeHtml(r.endLocal)}</td><td>${escapeHtml(
      r.title
    )}</td></tr>`;
  }
  table += `</tbody></table>`;
  table += `<form method="POST" action="/plan/confirm" class="inline-actions">`;
  table += `<button type="submit" name="intent" value="confirm">Confirm and create events</button>`;
  table += `<button formmethod="POST" formaction="/plan/discard" formnovalidate name="discard" value="1" type="submit" style="margin-left:8px;background:var(--warn);color:#2b1b00;">Discard draft</button>`;
  table += `<p class="muted sm">Creates events on your primary calendar. You can delete them anytime in Google Calendar.</p>`;
  table += `</form></div>`;
  return table;
}

function renderChatPage(opts) {
  const {
    connected,
    connectedEmail,
    connectUrl,
    banner,
    messages,
    previewRows,
    defaultTimeZoneLabel,
    formDisabledReason,
    initialWelcome,
  } = opts;

  const statusLine = connected
    ? `<div class="pill ok">Connected</div>`
    : `<div class="pill warn">Not connected</div>`;

  const connectSection = connected
    ? `<p class="muted">Connected as <strong>${escapeHtml(connectedEmail || "Unknown account")}</strong>.</p>
       <form method="POST" action="/disconnect" style="margin-top: 10px;">
         <button type="submit" class="disconnect">Disconnect Google</button>
       </form>`
    : `<a class="btn" href="${connectUrl}">Connect Google Calendar</a>
       <p class="muted">You’ll authorize Calendar access once. Needed to read openings and write events.</p>`;

  /** @type {{ role: string, text: string }[]} */
  const threadMsgs = [...messages];
  const hasAssist = threadMsgs.some((m) => m.role === "assistant");

  if (!hasAssist && typeof initialWelcome === "string") {
    threadMsgs.unshift({ role: "assistant", text: initialWelcome });
  }

  let threadHtml = "";
  for (const m of threadMsgs) threadHtml += renderChatBubble(m);
  threadHtml += renderPreviewCard(previewRows);

  const textareaDisabledAttr =
    connected && !formDisabledReason ? "" : "disabled aria-disabled=\"true\"";
  const hint =
    connected && !formDisabledReason ?
      ""
    : `<p class="muted sm">${escapeHtml(formDisabledReason || "Connect Calendar to send prompts.")}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Planner assistant</title>
    <style>
      :root { --bg:#0b0f19; --card:#111a2e; --text:#e9eefc; --muted:#a8b3d6; --ok:#2bd576; --warn:#ffcc66; --err:#ff5c7a; --btn:#5b8cff; }
      body { margin:0; font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; background: radial-gradient(1000px 600px at 20% 0%, #142347, var(--bg)); color: var(--text); min-height: 100vh; }
      .wrap { max-width: 720px; margin: 0 auto; padding: 20px 14px 32px; display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; }
      .card-head { flex: 0; background: color-mix(in oklab, var(--card), black 18%); border: 1px solid rgba(255,255,255,.08); border-radius: 14px 14px 0 0; padding: 14px 16px; border-bottom: 0; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
      .row { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap: wrap; }
      h1 { font-size: 18px; margin: 0; }
      .pill { padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid rgba(255,255,255,.12); align-self:flex-start;}
      .pill.ok { background: rgba(43,213,118,.12); color: var(--ok); }
      .pill.warn { background: rgba(255,204,102,.12); color: var(--warn); }
      .banner { margin-top:12px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);}
      .banner.ok {background:rgba(43,213,118,.10);}
      .banner.err{background:rgba(255,92,122,.12);}
      .muted{color:var(--muted);margin:8px 0 0;line-height:1.35;}
      .sm{font-size:12px;margin-top:6px;}
      .chat-shell{
        flex:1;
        background:color-mix(in oklab,var(--card),black 18%);
        border:1px solid rgba(255,255,255,.08);
        border-radius:0 0 14px 14px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);
        display:flex;flex-direction:column;min-height:360px;padding:0;}
      .thread{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px;border-top:1px solid rgba(255,255,255,.06);}
      .chat-row{display:flex;align-items:flex-end;gap:10px;width:100%;}
      .chat-row.user{justify-content:flex-end;}
      .chat-row.user .bubble{border-bottom-right-radius:4px;background:rgba(91,140,255,.22);border-color:rgba(91,140,255,.38);}
      .avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);}
      .bubble{max-width:min(560px,calc(100% - 60px));padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.18);font-size:14px;line-height:1.45;word-break:break-word;}
      .assistant-bubble{border-bottom-left-radius:4px;}
      .preview-card{margin-left:54px;background:rgba(0,0,0,.2);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);}
      @media(max-width:640px){.preview-card{margin-left:0}}
      .preview-h{margin:0 0 10px;font-size:13px;color:var(--muted);letter-spacing:.2px;}
      .preview-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;}
      .preview-table th,.preview-table td{border:1px solid rgba(255,255,255,.08);padding:8px 10px;text-align:left;}
      .composer{padding:14px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.12);border-radius:0 0 14px 14px;}
      textarea{width:100%;box-sizing:border-box;min-height:88px;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:var(--text);font:inherit;resize:vertical;}
      button,.btn{font:inherit;font-weight:700;cursor:pointer;border-radius:12px;padding:11px 16px;margin-top:10px;border:none;}
      .disconnect{margin-top:8px;background:var(--warn);color:#2b1b00;}
      .btn{display:inline-block;margin-top:10px;text-decoration:none;background:var(--btn);color:white;}
      .composer-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
      .footnote{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.35;}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card-head">
        <div class="row">
          <h1>Calendar planner assistant</h1>
          ${statusLine}
        </div>
        ${banner}
        <div style="margin-top:10px">${connectSection}</div>
      </div>
      <section class="chat-shell" aria-label="Chat planner">
        <div class="thread" id="thread">${threadHtml}</div>
        <div class="composer">
          ${hint}
          <form method="POST" action="/plan">
            <label for="prompt" style="clip: rect(0 0 0 0); clip-path:inset(50%);position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden">Describe project and availability</label>
            <textarea id="prompt" name="message" placeholder="${escapeHtml(
              `Say what you're working toward and roughly when you're free (time zone defaults to ${defaultTimeZoneLabel}).`
            )}" ${textareaDisabledAttr} maxlength="5800">${""}</textarea>
            <div class="composer-actions">
              <button type="submit" ${textareaDisabledAttr}>Send plan request</button>
            </div>
          </form>
          <p class="footnote">
            Scheduling uses Gemini (free-tier API) and sends your text plus busy/start-end windows from Calendar—no event titles pulled from Calendar.
          </p>
        </div>
      </section>
    </div>
    <script>
      (function () {
        var ta = document.getElementById("prompt");
        if (!ta) return;
        ta.addEventListener("keydown", function (e) {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return;
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          var btn = ta.closest("form") && ta.closest("form").querySelector('[type="submit"]:not(.disconnect)');
          if (btn && !btn.disabled && !ta.disabled) ta.closest("form").submit();
        });
        var th = document.getElementById("thread");
        if (th) th.scrollTop = th.scrollHeight;
      })();
    </script>
  </body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderChatPage,
};
