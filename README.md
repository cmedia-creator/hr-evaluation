# hr-evaluation

最小構成の人事評価システム（テスト版）です。

## 構成

- GitHub Pages
- Supabase Auth
- Supabase PostgreSQL
- Supabase RLS

## テストログイン

- 評価者ID: `EV0001`
- パスワード: Supabase Auth で設定したテスト用パスワード

画面上では評価者IDを入力しますが、内部で `ev0001@internal.local` に変換してSupabase Authへログインします。

## 公開方法

1. このフォルダ内のファイルをGitHubリポジトリのルートへアップロード
2. GitHubの `Settings`
3. `Pages`
4. `Build and deployment` の Source を `Deploy from a branch`
5. Branch を `main` / `/(root)` にして保存

数分後にGitHub PagesのURLが発行されます。

## 注意

これはテスト版です。実在社員の個人情報や本番評価情報は入れないでください。
