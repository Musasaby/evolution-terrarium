# AGENTS.md

このファイルはすべてのAIエージェント(Claude Code、OpenCode等)向け指示の**正本**です。
`CLAUDE.md` はこのファイルをimportする1行ラッパーであり、内容はここにのみ記載します。

## プロジェクト概要

- プロジェクト名: evolution-terrarium(円柱生物の進化箱庭)
- 技術スタック: ビルド不要の静的サイト(素の ES モジュール)、three.js(3D 描画)、Rapier(`@dimforge/rapier3d-compat`、物理エンジン)。npm は動作確認ツール用
- 主要ディレクトリ:
  - `src/app/` — 起動と配線・状態ストア・毎フレームのループ
  - `src/sim/` — シミュレーション本体(描画・DOM に依存しない。Node でも動く)
  - `src/render/` — three.js による 3D 描画(sim を読むだけ)
  - `src/ui/` — ヘッダー・右パネル・操作ボタン(ストアを読み書きする)
  - `src/perf/` — パフォーマンス計測と表示
  - `tools/` — ブラウザ不要の動作確認(`sim-check.mjs`)
- 構成・依存の向き・よくある変更の入口は `ARCHITECTURE.md` を参照すること

## エージェント共通ルール

- 回答・コミットメッセージ・ドキュメントは日本語で記述する(コード識別子は除く)
- コミットは conventional commits 形式: `<type>: <description>`(type: feat, fix, refactor, docs, test, chore, perf, ci)
- `main` ブランチへの直接コミットは禁止。作業は `develop/<作業名>` ブランチで行う
- 実装後は関連テストを実行し、結果を報告する

## テスト・検証の注意(子エージェント向け)

- 動作確認は `npm install` 後に `npm run check:sim`(600 ステップ進めて状態ハッシュと区間ごとの所要時間を表示)。`node tools/sim-check.mjs <ステップ数> <シード>` で指定も可
- 同じシード・同じステップ数なら状態ハッシュは常に同じ。**振る舞いを変えないつもりの変更(リファクタリング)では、変更前後でハッシュが一致すること**を確認して報告する。パラメータや規則を変えた場合はハッシュが変わるのが正常(その旨を報告に書く)
- sim を外から使うときは `src/sim/index.js` からだけ import する。依存は一方向(下の層は上の層を知らない)を守る
- 剛体の姿勢は `c.pos[i]` `c.rot[i]` `c.angv[i]` の写しを読む(`translation()` 等を直接呼ばない)
- 描画・UI の変更はブラウザ確認が必要(`npm run serve` → http://localhost:8000)。ヘッドレスで確認できない場合はその旨を報告する

## マルチエージェントワークフロー

複数エージェント協調の実装ワークフローは `.agents/skills/` の各skillで定義されている。

- 状態・設定の正本: `.agents/workflow/`(`config.json`, `tasks.md`, `state.json`)
- 子エージェントとして実装を依頼された場合は、タスク定義(`.agents/workflow/tasks.md`)の受け入れ基準を満たし、テストを実行してから完了報告すること
- 理解確認(任意): `comprehension_check.enabled` が true の場合、各タスク完了後に質問ファイルが生成されます。回答を記入して `/agent-comprehension-check` を実行すると判定・解説が得られます(別セッションでも可)
- 問題発生時の対応順序: 1) `multi-ai-agents-workflow` 由来の問題かを切り分け 2) スクリプトによる自動化などAIの性能に依存しない機械的改善を最優先で検討 3) 2 が難しい場合のみ skills/AGENTS.md 等ドキュメントの改善で対処 4) ワークフロー由来、または解決困難な場合はユーザーに報告して中断 5) ワークフロー由来の問題は、ユーザーの承認を得て upstream(配布元)リポジトリに Issue を起票する(詳細は `agent-workflow` skillの「問題発生時の対応順序」を参照)

## セットアップ(clone直後)

リンク類(`.claude` ジャンクション等)はリポジトリにコミットされない。clone後に
`/agents-md-setup` skillを実行するか、`.agents/skills/agents-md-setup/SKILL.md` の手順でリンクを再作成すること。

`.agents/skills/` は `git subtree` で取り込んだ配布物です。更新が必要な場合は `workflow-update` skill を実行するか、`git subtree pull` で取り込んでください。配布元の skill は直接編集せず、利用先固有の変更が必要な場合は別名ディレクトリで追加してください。
