# Firebase同期のセットアップ

このアプリはGitHub Pagesのまま、Firebase AuthenticationとCloud Firestoreを使って端末間同期できます。独自サーバーは不要です。

1. [Firebase Console](https://console.firebase.google.com/)でプロジェクトを作成します。
2. 「プロジェクトの設定」からWebアプリを追加します。
3. Authenticationの「Sign-in method」でGoogleを有効にします。
4. Cloud Firestoreを本番モードで作成します。
5. Authenticationの「設定 > 承認済みドメイン」に `haura900.github.io` を追加します。
6. WebアプリのFirebase設定を [`docs/firebase-config.js`](docs/firebase-config.js) に記入します。空欄のままなら同期機能だけが無効になり、ローカル版は動作します。
7. Firebase CLIで、このリポジトリの [`firestore.rules`](firestore.rules) をデプロイします。

   ```powershell
   firebase login
   firebase init firestore
   firebase deploy --only firestore:rules
   ```

   `firebase init` でルールファイルを聞かれた場合は `firestore.rules` を指定してください。テストモードの全許可ルールは使用しません。

8. 変更をGitHubへ反映し、GitHub Pagesのデプロイ完了を待ちます。
9. PCとスマートフォンで `https://haura900.github.io/nanikiru-drill-generator/` を開き、同じGoogleアカウントでログインして同期を確認します。

## 確認項目

- 初回ログインで、ローカルとクラウドの両方にデータがある場合は選択画面が出る
- PCで解答した後、スマートフォンへ問題・履歴・復習予定が反映される
- 問題の追加・編集・削除、ジャンル順、復習設定、類題作成数が反映される
- オフライン中も操作でき、オンライン復帰後に同期される
- 異なる端末で同時に変更すると競合画面が出る
- 完全初期化でクラウドと端末の両方が削除される

FirebaseのWeb設定値はブラウザ向けの識別情報であり、アクセス制御はAuthenticationとSecurity Rulesで行います。サービスアカウント秘密鍵、Admin SDKの秘密情報、秘密鍵ファイルはリポジトリへ追加しないでください。
