# 北日本 放射線治療施設アクセスマップ

北海道・東北6県・新潟県（計8道県）における放射線治療施設への最短アクセス時間を、1kmメッシュ単位で可視化するWebアプリケーション。

## 対象地域

| コード | 道県名 | 施設数 |
|--------|--------|--------|
| 01 | 北海道 | 38 |
| 02 | 青森県 | — |
| 03 | 岩手県 | 1 |
| 04 | 宮城県 | 14 |
| 05 | 秋田県 | — |
| 06 | 山形県 | 4 |
| 07 | 福島県 | 1 |
| 15 | 新潟県 | — |

「—」は今後データを追加予定。

## Webアプリの閲覧

`index.html` をブラウザで開く。data/ ディレクトリに前処理済みデータが必要。

## 前処理の実行

### 必要環境

- R (4.0以上) + パッケージ: sf, dplyr, httr, jsonlite
- Docker（OSRMサーバ用）

### OSRMサーバの準備

1. Geofabrik から japan-latest.osm.pbf をダウンロードし raw_data/osrm/ に配置
2. OSRMデータを構築:

```
docker run -t -v "${PWD}/raw_data/osrm:/data" osrm/osrm-backend osrm-extract -p /data/car_jp_medical.lua /data/japan-latest.osm.pbf
docker run -t -v "${PWD}/raw_data/osrm:/data" osrm/osrm-backend osrm-partition /data/japan-latest.osrm
docker run -t -v "${PWD}/raw_data/osrm:/data" osrm/osrm-backend osrm-customize /data/japan-latest.osrm
```

3. サーバ起動: `docker compose -f osrm/docker-compose.yml up -d`

### パイプライン実行

```
# 全道県
Rscript preprocessing/run_all.R

# 特定の道県のみ
Rscript preprocessing/run_all.R --pref 04
Rscript preprocessing/run_all.R --pref 01,04
```

### 施設の追加・更新

`preprocessing/facilities.csv` を編集し、パイプラインを再実行する。

## データ出典

- **人口**: 令和2年国勢調査（総務省統計局）— [e-Stat](https://www.e-stat.go.jp/)
- **道路**: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- **経路計算**: [OSRM](http://project-osrm.org/) (BSD 2-Clause)
- **行政境界**: [GADM](https://gadm.org/) v4.1
- **地図タイル**: [国土地理院](https://maps.gsi.go.jp/development/ichiran.html)
- **速度設定**: 松田ら (2018)「医療計画作成支援データブック」

## ディレクトリ構成

```
/
├── index.html, app.js, style.css  # Webアプリ（公開対象）
├── data/                           # 前処理済みJSON（公開対象）
├── preprocessing/                  # 前処理Rスクリプト群
│   ├── facilities.csv              # 施設マスタ
│   ├── 00_config.R ... 04_export_json.R
│   ├── run_all.R
│   └── functions/
├── osrm/                           # OSRMプロファイル・Docker設定
├── docs/SPECIFICATION.md           # 技術仕様書
└── raw_data/                       # 生データ（gitignore）
```

## ライセンス

本アプリケーションは研究目的で作成されたものであり、公的機関の公式情報ではありません。詳細はアプリケーション内の免責事項を参照してください。
