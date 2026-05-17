# 微信小程序云开发 - 数据备份与恢复工具

用于微信小程序云开发数据库和云存储的本地备份与恢复脚本，支持按影集→子类→作品的层级结构导出和导入数据。

## 功能特性

### 备份功能 (backup.js)
- 导出指定数据库集合的完整数据
- 下载云存储中的作品图片到本地
- 按影集→子类→作品的层级结构组织文件
- 生成备份报告，记录成功/失败统计
- 支持并发下载，提高效率

### 恢复功能 (restore.js)
- 从备份文件恢复数据库记录
- 上传本地图片到云存储
- 支持增量同步（默认）和全量同步两种模式
- 自动关联图片 URL 到数据库记录

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置腾讯云密钥

通过环境变量设置密钥（推荐）：

**PowerShell:**
```powershell
$env:TENCENT_SECRET_ID = "your-secret-id"
$env:TENCENT_SECRET_KEY = "your-secret-key"
```

**CMD:**
```cmd
set TENCENT_SECRET_ID=your-secret-id
set TENCENT_SECRET_KEY=your-secret-key
```

**Linux/Mac:**
```bash
export TENCENT_SECRET_ID="your-secret-id"
export TENCENT_SECRET_KEY="your-secret-key"
```

> 获取密钥方式：腾讯云控制台 → 访问管理 → 访问密钥 → API密钥管理

### 3. 运行备份

```bash
npm run backup
```

备份文件将保存在 `./backup/backup_YYYY-MM-DDTHH-mm-ss/` 目录下，包含：
- `database.json` - 数据库导出文件
- `works/` - 作品图片，按影集/子类/作品ID组织
- `report.json` - 备份报告

### 4. 运行恢复

**增量模式（默认）：**
```bash
npm run restore
```

**全量模式：**
```bash
npm run restore:full
```

**指定备份路径：**
```powershell
$env:BACKUP_PATH = "./backup/backup_2026-05-17T13-24-04"
npm run restore
```

## 配置说明

### backup.js 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| envId | 云环境ID | 必填 |
| secretId | 腾讯云 SecretId | 环境变量 |
| secretKey | 腾讯云 SecretKey | 环境变量 |
| projectPath | 小程序项目路径 | `../makeupApp` |
| backupDir | 备份输出目录 | `./backup` |
| collections | 需要备份的集合 | 见配置 |
| maxConcurrent | 图片下载并发数 | 5 |

### restore.js 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| envId | 云环境ID | 必填 |
| secretId | 腾讯云 SecretId | 环境变量 |
| secretKey | 腾讯云 SecretKey | 环境变量 |
| backupPath | 备份文件路径 | 环境变量 |
| mode | 同步模式 | `incremental` |
| collections | 需要恢复的集合 | 见配置 |
| cloudPathPrefix | 云存储路径前缀 | `backup_restore/` |
| maxConcurrent | 图片上传并发数 | 5 |

## 同步模式说明

### 增量模式 (incremental)
- 只插入新记录，不删除已有数据
- 更新已存在记录的内容
- 适用于日常数据同步

### 全量模式 (full)
- 清空集合后重新导入
- 会删除不在备份中的数据
- 适用于完整恢复场景

## 腾讯云 CAM 权限配置

使用子账号密钥时，需要配置以下策略：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "tcb:QueryDocument",
        "tcb:InsertItem",
        "tcb:UpdateItem",
        "tcb:DeleteItem",
        "tcb:DownloadFile",
        "tcb:UploadFile",
        "tcb:DescribeFileUrl"
      ],
      "resource": "*"
    }
  ]
}
```

## 备份目录结构

```
backup_YYYY-MM-DDTHH-mm-ss/
├── database.json          # 数据库导出
├── report.json            # 备份报告
└── works/                 # 作品图片
    └── 影集名称/
        └── 子类名称/
            └── 作品ID/
                ├── cover.jpg
                ├── image_1.jpg
                ├── image_2.jpg
                └── meta.json
```

## 注意事项

1. **密钥安全**：不要将密钥硬编码在脚本中，务必使用环境变量
2. **备份频率**：建议定期备份，特别是在批量修改数据前
3. **恢复测试**：恢复前建议先在测试环境验证
4. **网络环境**：需要能够访问腾讯云 API 和网络
5. **权限要求**：确保子账号具有相应的云开发和云存储权限
