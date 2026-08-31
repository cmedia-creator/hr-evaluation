// 全社員共通ログイン対応
// 既存 app.js 読み込み後に実行してください。
// 社員番号 + マスタ設定パスワードでログイン。
// 初回ログイン時のみ bootstrap_employee_account RPC で Supabase Auth アカウントを自動作成します。

(() => {
  const loginForm = document.getElementById("loginForm");
  const loginId = document.getElementById("loginId");
  const password = document.getElementById("password");
  const loginMessage = document.getElementById("loginMessage");

  if (!loginForm || !loginId || !password) return;

  // 画面表示も「評価者ID」ではなく「社員番号」に寄せる
  const intro = loginForm.querySelector("h2 + p");
  if (intro) intro.textContent = "社員番号とパスワードを入力してください。";

  const idLabel = loginId.closest("label");
  if (idLabel) {
    const textNode = Array.from(idLabel.childNodes).find(
      n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
    );
    if (textNode) textNode.textContent = "社員番号\n          ";
  }

  // 旧テストIDの初期値は消す
  if (loginId.value === "EV0001") loginId.value = "";
  loginId.placeholder = "例：003";
  loginId.inputMode = "numeric";

  function showMessage(text = "", type = "") {
    if (!loginMessage) return;
    loginMessage.textContent = text;
    loginMessage.className = "message" + (type ? ` ${type}` : "");
  }

  function internalEmail(id) {
    return `${id.trim().toLowerCase()}@internal.local`;
  }

  async function signIn(id, pw) {
    return await client.auth.signInWithPassword({
      email: internalEmail(id),
      password: pw
    });
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    showMessage();

    const id = loginId.value.trim();
    const pw = password.value;

    if (!id || !pw) {
      showMessage("社員番号とパスワードを入力してください。", "error");
      return;
    }

    const submitButton = loginForm.querySelector('button[type="submit"], button:not([type])');
    if (submitButton) submitButton.disabled = true;

    try {
      // 1. 既に Auth アカウントがある場合は通常ログイン
      let result = await signIn(id, pw);

      // 2. 初回ログインなら、マスタ照合後に Auth アカウントを自動作成
      if (result.error) {
        const { data: bootstrapped, error: bootstrapError } = await client.rpc(
          "bootstrap_employee_account",
          {
            p_login_id: id,
            p_password: pw
          }
        );

        if (bootstrapError || bootstrapped !== true) {
          showMessage("社員番号またはパスワードが違います。", "error");
          return;
        }

        // 3. 作成直後に通常ログイン
        result = await signIn(id, pw);
      }

      if (result.error) {
        showMessage("社員番号またはパスワードが違います。", "error");
        return;
      }

      try {
        await boot();
      } catch (err) {
        console.error(err);
        showMessage(err?.message || "初期化に失敗しました。", "error");
      }
    } catch (err) {
      console.error(err);
      showMessage("ログイン処理でエラーが発生しました。", "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  };
})();
