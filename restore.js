/**
 * 微信小程序云开发数据恢复/同步脚本
 * 从备份文件恢复数据到云数据库，并上传本地图片到云存储
 * 
 * 使用方法:
 * 1. 安装依赖: npm install
 * 2. 运行: node restore.js
 * 
 * 模式说明:
 * - 增量模式: 只插入新记录，更新已存在记录（默认）
 * - 全量模式: 清空集合后重新导入所有数据
 */

const cloud = require('wx-server-sdk')
const fs = require('fs')
const path = require('path')

// ==================== 配置区 ====================
const config = {
  // 云环境ID
  envId: 'cloud1-d6gmlx4ss77f8e361',
  
  // 腾讯云密钥（本地运行时需要配置）
  secretId: process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENT_SECRET_KEY || '',
  
  // 备份文件路径（包含 database.json 的目录）
  // 例如: './backup/backup_2026-05-17T13-24-04'
  backupPath: process.env.BACKUP_PATH || '',
  
  // 同步模式: 'incremental' (增量) 或 'full' (全量)
  mode: process.env.SYNC_MODE || 'incremental',
  
  // 需要恢复的集合
  collections: ['categories', 'subcategories', 'works', 'featured', 'contactInfo'],
  
  // 云存储上传路径前缀
  cloudPathPrefix: 'backup_restore/',
  
  // 图片上传并发数
  maxConcurrent: 3
}
// ================================================

// 初始化云开发
const initConfig = {
  env: config.envId
}

if (config.secretId && config.secretKey) {
  initConfig.secretId = config.secretId
  initConfig.secretKey = config.secretKey
}

cloud.init(initConfig)

const db = cloud.database()
const _ = db.command

/**
 * 读取备份数据
 */
function loadBackupData() {
  if (!config.backupPath) {
    console.error('错误: 未指定备份路径')
    console.log('使用方法:')
    console.log('  Windows PowerShell:')
    console.log('    $env:BACKUP_PATH = "./backup/backup_2026-05-17T13-24-04"')
    console.log('    node restore.js')
    console.log('')
    console.log('  或直接修改 backup.js 中的 backupPath 配置')
    process.exit(1)
  }
  
  const dbJsonPath = path.join(config.backupPath, 'database.json')
  
  if (!fs.existsSync(dbJsonPath)) {
    console.error(`错误: 备份文件不存在: ${dbJsonPath}`)
    process.exit(1)
  }
  
  console.log(`读取备份文件: ${dbJsonPath}`)
  const data = JSON.parse(fs.readFileSync(dbJsonPath, 'utf-8'))
  return data
}

/**
 * 清空集合
 */
async function clearCollection(collectionName) {
  console.log(`  清空集合: ${collectionName}`)
  
  const collection = db.collection(collectionName)
  let hasMore = true
  
  while (hasMore) {
    const res = await collection.limit(100).get()
    
    if (res.data.length === 0) {
      hasMore = false
      break
    }
    
    const ids = res.data.map(doc => doc._id)
    await collection.where({
      _id: _.in(ids)
    }).remove()
    
    console.log(`    已删除 ${ids.length} 条记录`)
  }
}

/**
 * 插入或更新记录
 */
async function upsertRecord(collectionName, record) {
  const collection = db.collection(collectionName)
  
  try {
    // 尝试查找记录
    const existing = await collection.doc(record._id).get()
    
    if (existing.data) {
      // 记录已存在，更新
      const { _id, ...updateData } = record
      await collection.doc(_id).update({
        data: updateData
      })
      return 'updated'
    }
  } catch (err) {
    // 记录不存在，插入
    if (err.errCode === -502005 || err.message.includes('doc not found')) {
      await collection.add({
        data: record
      })
      return 'inserted'
    }
    throw err
  }
  
  return 'skipped'
}

/**
 * 同步单个集合
 */
async function syncCollection(collectionName, records) {
  console.log(`\n同步集合: ${collectionName} (${records.length} 条记录)`)
  
  if (!records || records.length === 0) {
    console.log('  无数据，跳过')
    return { inserted: 0, updated: 0, failed: 0 }
  }
  
  // 全量模式：先清空集合
  if (config.mode === 'full') {
    await clearCollection(collectionName)
  }
  
  let inserted = 0
  let updated = 0
  let failed = 0
  
  for (const record of records) {
    try {
      const result = await upsertRecord(collectionName, record)
      
      if (result === 'inserted') inserted++
      else if (result === 'updated') updated++
      
      if ((inserted + updated + failed) % 10 === 0) {
        console.log(`  进度: ${inserted + updated + failed}/${records.length}`)
      }
    } catch (err) {
      failed++
      console.error(`  失败: ${record._id || 'unknown'} - ${err.message}`)
    }
  }
  
  console.log(`  完成: 插入 ${inserted}, 更新 ${updated}, 失败 ${failed}`)
  return { inserted, updated, failed }
}

/**
 * 上传文件到云存储
 */
async function uploadFile(localPath, cloudPath) {
  try {
    const result = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: fs.readFileSync(localPath)
    })
    return result.fileID
  } catch (err) {
    console.error(`    上传失败: ${localPath} - ${err.message}`)
    return null
  }
}

/**
 * 扫描并上传本地图片
 */
async function uploadLocalImages() {
  const worksDir = path.join(config.backupPath, 'works')
  
  if (!fs.existsSync(worksDir)) {
    console.log('\n未发现本地图片目录，跳过图片上传')
    return
  }
  
  console.log('\n[2/2] 上传本地图片到云存储...')
  
  const imageFiles = []
  
  // 递归扫描图片文件
  function scanDir(dirPath, relativePath = '') {
    const items = fs.readdirSync(dirPath)
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item)
      const stat = fs.statSync(fullPath)
      
      if (stat.isDirectory()) {
        scanDir(fullPath, path.join(relativePath, item))
      } else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(item)) {
        imageFiles.push({
          localPath: fullPath,
          relativePath: path.join(relativePath, item),
          fileName: item
        })
      }
    }
  }
  
  scanDir(worksDir)
  
  if (imageFiles.length === 0) {
    console.log('  未发现图片文件')
    return
  }
  
  console.log(`  发现 ${imageFiles.length} 个图片文件`)
  
  let successCount = 0
  let failCount = 0
  const fileIds = []
  
  // 并发上传
  for (let i = 0; i < imageFiles.length; i += config.maxConcurrent) {
    const batch = imageFiles.slice(i, i + config.maxConcurrent)
    
    const promises = batch.map(async (file) => {
      const cloudPath = config.cloudPathPrefix + file.relativePath.replace(/\\/g, '/')
      const fileID = await uploadFile(file.localPath, cloudPath)
      
      if (fileID) {
        successCount++
        fileIds.push({
          localPath: file.localPath,
          fileID: fileID,
          relativePath: file.relativePath
        })
        console.log(`    ✓ ${file.relativePath}`)
      } else {
        failCount++
      }
    })
    
    await Promise.all(promises)
  }
  
  console.log(`\n  上传完成: 成功 ${successCount}, 失败 ${failCount}`)
  
  // 保存文件ID映射
  if (fileIds.length > 0) {
    const mappingPath = path.join(config.backupPath, 'file_ids.json')
    fs.writeFileSync(mappingPath, JSON.stringify(fileIds, null, 2), 'utf-8')
    console.log(`  文件ID映射已保存: ${mappingPath}`)
  }
}

/**
 * 主函数
 */
async function main() {
  const startTime = Date.now()
  
  console.log('='.repeat(50))
  console.log('开始恢复/同步数据...')
  console.log(`模式: ${config.mode === 'full' ? '全量覆盖' : '增量同步'}`)
  console.log(`备份路径: ${config.backupPath}`)
  console.log('='.repeat(50))
  
  // 1. 加载备份数据
  console.log('\n[1/2] 加载备份数据...')
  const backupData = loadBackupData()
  
  // 2. 同步集合
  console.log('\n同步数据库集合...')
  const stats = {}
  
  for (const collection of config.collections) {
    const records = backupData[collection] || []
    stats[collection] = await syncCollection(collection, records)
  }
  
  // 3. 上传本地图片
  await uploadLocalImages()
  
  // 4. 生成报告
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  
  console.log('\n' + '='.repeat(50))
  console.log('恢复/同步完成!')
  console.log(`  耗时: ${duration}秒`)
  console.log(`  模式: ${config.mode === 'full' ? '全量覆盖' : '增量同步'}`)
  console.log('\n  集合同步统计:')
  
  for (const [collection, stat] of Object.entries(stats)) {
    console.log(`    ${collection}: 插入 ${stat.inserted}, 更新 ${stat.updated}, 失败 ${stat.failed}`)
  }
  
  console.log('='.repeat(50))
}

// 执行
main().catch(err => {
  console.error('恢复失败:', err)
  process.exit(1)
})
