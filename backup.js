/**
 * 微信小程序云开发数据备份脚本
 * 按 影集 -> 子类 -> 作品 的层级结构导出数据库和图片
 * 
 * 使用方法:
 * 1. 安装依赖: npm install
 * 2. 运行: node backup.js
 */

const cloud = require('wx-server-sdk')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

// ==================== 配置区 ====================
const config = {
  // 云环境ID，从 project.config.json 中获取
  envId: 'cloud1-d6gmlx4ss77f8e361',
  
  // 腾讯云密钥（本地运行时需要配置）
  // 获取方式：小程序后台 -> 云开发 -> 设置 -> 环境变量
  // 或者：腾讯云控制台 -> 访问管理 -> 访问密钥 -> API密钥管理
  // 建议通过环境变量设置：$env:TENCENT_SECRET_ID / $env:TENCENT_SECRET_KEY
  secretId: process.env.TENCENT_SECRET_ID || '',
  secretKey: process.env.TENCENT_SECRET_KEY || '',
  
  // 小程序项目路径（用于读取配置）
  projectPath: '../makeupApp',
  
  // 备份输出目录
  backupDir: './backup',
  
  // 需要备份的集合
  collections: ['categories', 'subcategories', 'works', 'featured', 'contactInfo'],
  
  // 图片下载并发数
  maxConcurrent: 5
}
// ================================================

// 初始化云开发
const initConfig = {
  env: config.envId
}

// 如果配置了密钥，使用密钥初始化（本地运行）
if (config.secretId && config.secretKey) {
  initConfig.secretId = config.secretId
  initConfig.secretKey = config.secretKey
}

cloud.init(initConfig)

const db = cloud.database()
const _ = db.command

/**
 * 安全创建目录
 */
function mkdirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 获取集合所有数据（处理分页）
 */
async function getCollectionData(collectionName) {
  console.log(`正在导出集合: ${collectionName}`)
  
  const limit = 100
  let allData = []
  let skip = 0
  
  while (true) {
    const res = await db.collection(collectionName)
      .skip(skip)
      .limit(limit)
      .get()
    
    allData = allData.concat(res.data)
    
    if (res.data.length < limit) break
    skip += limit
  }
  
  console.log(`  - 导出 ${allData.length} 条记录`)
  return allData
}

/**
 * 下载文件
 */
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    
    const request = client.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        downloadFile(res.headers.location, filePath).then(resolve).catch(reject)
        return
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`))
        return
      }
      
      const fileStream = fs.createWriteStream(filePath)
      res.pipe(fileStream)
      
      fileStream.on('finish', () => {
        fileStream.close()
        resolve(filePath)
      })
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {})
        reject(err)
      })
    })
    
    request.on('error', (err) => {
      reject(err)
    })
    
    request.setTimeout(30000, () => {
      request.destroy()
      reject(new Error('下载超时'))
    })
  })
}

/**
 * 获取云存储临时URL
 */
async function getTempFileURL(fileIds) {
  if (!fileIds || fileIds.length === 0) return {}
  
  const cloudFileIds = fileIds.filter(id => id && id.startsWith('cloud://'))
  if (cloudFileIds.length === 0) return {}
  
  try {
    const res = await cloud.getTempFileURL({
      fileList: cloudFileIds
    })
    
    const urlMap = {}
    res.fileList.forEach(file => {
      urlMap[file.fileID] = file.tempFileURL
    })
    
    return urlMap
  } catch (err) {
    console.error('获取临时URL失败:', err)
    return {}
  }
}

/**
 * 安全文件名处理
 */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

/**
 * 主备份函数
 */
async function backup() {
  const startTime = Date.now()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(config.backupDir, `backup_${timestamp}`)
  
  console.log('='.repeat(50))
  console.log('开始备份...')
  console.log('备份目录:', backupPath)
  console.log('='.repeat(50))
  
  mkdirSync(backupPath)
  
  // 1. 导出所有集合数据
  console.log('\n[1/3] 导出数据库集合...')
  const allData = {}
  
  for (const collection of config.collections) {
    try {
      allData[collection] = await getCollectionData(collection)
    } catch (err) {
      console.error(`  导出集合 ${collection} 失败:`, err.message)
      allData[collection] = []
    }
  }
  
  // 保存数据库JSON
  const dbJsonPath = path.join(backupPath, 'database.json')
  fs.writeFileSync(dbJsonPath, JSON.stringify(allData, null, 2), 'utf-8')
  console.log(`  数据库已保存: ${dbJsonPath}`)
  
  // 2. 构建层级结构并下载图片
  console.log('\n[2/3] 下载作品图片...')
  
  const works = allData.works || []
  const categories = allData.categories || []
  const subcategories = allData.subcategories || []
  
  // 构建分类映射
  const catMap = {}
  categories.forEach(cat => {
    catMap[cat._id] = cat.name || '未分类影集'
  })
  
  const subMap = {}
  subcategories.forEach(sub => {
    subMap[sub._id] = sub.name || '未分类子类'
  })
  
  // 收集所有云存储File ID
  const allFileIds = []
  works.forEach(work => {
    if (work.coverImage && work.coverImage.startsWith('cloud://')) {
      allFileIds.push(work.coverImage)
    }
    if (work.images && Array.isArray(work.images)) {
      work.images.forEach(img => {
        if (img.startsWith('cloud://')) {
          allFileIds.push(img)
        }
      })
    }
  })
  
  // 获取云存储临时URL
  console.log(`  发现 ${allFileIds.length} 个云存储文件`)
  const urlMap = await getTempFileURL(allFileIds)
  
  // 按层级下载图片
  let successCount = 0
  let failCount = 0
  const downloadQueue = []
  
  works.forEach(work => {
    const catName = sanitizeFilename(catMap[work.categoryId] || work.categoryName || '未分类影集')
    const subName = sanitizeFilename(subMap[work.subcategoryId] || work.subcategoryName || '未分类子类')
    const workName = sanitizeFilename(work.title || work._id || '未命名作品')
    
    const workDir = path.join(backupPath, 'works', catName, subName, workName)
    mkdirSync(workDir)
    
    // 保存作品元数据
    const workMeta = { ...work }
    delete workMeta.images
    fs.writeFileSync(
      path.join(workDir, 'meta.json'),
      JSON.stringify(workMeta, null, 2),
      'utf-8'
    )
    
    // 下载封面
    if (work.coverImage) {
      const coverUrl = work.coverImage.startsWith('cloud://') 
        ? (urlMap[work.coverImage] || work.coverImage)
        : work.coverImage
      
      if (coverUrl && coverUrl.startsWith('http')) {
        downloadQueue.push({
          url: coverUrl,
          path: path.join(workDir, 'cover.jpg'),
          workTitle: work.title
        })
      }
    }
    
    // 下载作品图片
    if (work.images && Array.isArray(work.images)) {
      work.images.forEach((img, index) => {
        const imgUrl = img.startsWith('cloud://')
          ? (urlMap[img] || img)
          : img
        
        if (imgUrl && imgUrl.startsWith('http')) {
          const ext = imgUrl.split('.').pop().split('?')[0] || 'jpg'
          downloadQueue.push({
            url: imgUrl,
            path: path.join(workDir, `image_${index + 1}.${ext}`),
            workTitle: work.title
          })
        }
      })
    }
  })
  
  // 并发下载
  console.log(`  共 ${downloadQueue.length} 个文件待下载`)
  
  for (let i = 0; i < downloadQueue.length; i += config.maxConcurrent) {
    const batch = downloadQueue.slice(i, i + config.maxConcurrent)
    const promises = batch.map(item => 
      downloadFile(item.url, item.path)
        .then(() => {
          successCount++
          console.log(`    ✓ ${item.workTitle}`)
        })
        .catch(err => {
          failCount++
          console.error(`    ✗ ${item.workTitle}: ${err.message}`)
        })
    )
    
    await Promise.all(promises)
  }
  
  console.log(`  下载完成: 成功 ${successCount}, 失败 ${failCount}`)
  
  // 3. 生成备份报告
  console.log('\n[3/3] 生成备份报告...')
  
  const report = {
    backupTime: new Date().toISOString(),
    envId: config.envId,
    collections: {},
    works: {
      total: works.length,
      byCategory: {}
    },
    images: {
      total: downloadQueue.length,
      success: successCount,
      failed: failCount
    }
  }
  
  config.collections.forEach(col => {
    report.collections[col] = (allData[col] || []).length
  })
  
  works.forEach(work => {
    const catName = catMap[work.categoryId] || work.categoryName || '未分类'
    if (!report.works.byCategory[catName]) {
      report.works.byCategory[catName] = 0
    }
    report.works.byCategory[catName]++
  })
  
  const reportPath = path.join(backupPath, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  
  const readmePath = path.join(backupPath, 'README.md')
  fs.writeFileSync(readmePath, generateReadme(report), 'utf-8')
  
  // 完成
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  
  console.log('\n' + '='.repeat(50))
  console.log('备份完成!')
  console.log(`  耗时: ${duration}秒`)
  console.log(`  目录: ${backupPath}`)
  console.log(`  集合: ${Object.values(report.collections).reduce((a, b) => a + b, 0)} 条记录`)
  console.log(`  作品: ${report.works.total} 个`)
  console.log(`  图片: ${successCount} 个成功, ${failCount} 个失败`)
  console.log('='.repeat(50))
}

/**
 * 生成README
 */
function generateReadme(report) {
  const lines = [
    '# 备份报告',
    '',
    `**备份时间**: ${report.backupTime}`,
    `**云环境**: ${report.envId}`,
    '',
    '## 数据统计',
    '',
    '### 集合记录数',
    '| 集合 | 记录数 |',
    '|------|--------|',
    ...Object.entries(report.collections).map(([name, count]) => `| ${name} | ${count} |`),
    '',
    '### 作品分布',
    '| 影集 | 作品数 |',
    '|------|--------|',
    ...Object.entries(report.works.byCategory).map(([name, count]) => `| ${name} | ${count} |`),
    '',
    '### 图片下载',
    `- 总数: ${report.images.total}`,
    `- 成功: ${report.images.success}`,
    `- 失败: ${report.images.failed}`,
    '',
    '## 目录结构',
    '',
    '```',
    'backup/',
    '├── database.json      # 完整数据库导出',
    '├── report.json        # 备份报告',
    '├── README.md          # 本文件',
    '└── works/             # 作品图片',
    '    ├── [影集名称]/',
    '    │   ├── [子类名称]/',
    '    │   │   ├── [作品名称]/',
    '    │   │   │   ├── meta.json    # 作品元数据',
    '    │   │   │   ├── cover.jpg    # 封面',
    '    │   │   │   ├── image_1.jpg  # 作品图片1',
    '    │   │   │   └── ...',
    '```',
    ''
  ]
  
  return lines.join('\n')
}

// 执行备份
backup().catch(err => {
  console.error('备份失败:', err)
  process.exit(1)
})
