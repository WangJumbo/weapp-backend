const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080; // Zeabur 通常使用 8080 端口

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB 连接
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('错误: 未设置 MONGODB_URI 环境变量');
  process.exit(1);
}

// 验证连接字符串格式
if (!MONGODB_URI.startsWith('mongodb://') && !MONGODB_URI.startsWith('mongodb+srv://')) {
  console.error('错误: MongoDB 连接字符串格式不正确，必须以 mongodb:// 或 mongodb+srv:// 开头');
  console.error('当前值:', MONGODB_URI);
  process.exit(1);
}

// 连接数据库
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('成功连接到 MongoDB 数据库');
})
.catch(err => {
  console.error('连接 MongoDB 数据库失败:', err);
  process.exit(1);
});

// 数据库模式
const GoodsSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  score: { type: Number, required: true },
  desc: { type: String, required: true },
  image: { type: String, required: true },
  openid: { type: String, required: true }, // 模拟微信用户ID
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const ConfigSchema = new mongoose.Schema({
  openid: { type: String, required: true, unique: true },
  bannerImage: { type: String, default: "/images/banner.png" },
  bannerTitle: { type: String, default: "萌宠好礼 积分兑换" },
  ruleList: { type: [String], default: [
    "每消费1元可获得1积分，积分永久有效",
    "兑换商品需满足积分数量，积分扣除后不可退回",
    "商品数量有限，兑完即止，不设退换",
    "最终解释权归喜饼宠物所有"
  ]},
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Goods = mongoose.model('Goods', GoodsSchema);
const Config = mongoose.model('Config', ConfigSchema);

// Multer 配置用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// API 路由

// 获取商品列表
app.get('/api/goods', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) {
      return res.status(400).json({ error: 'Missing openid' });
    }
    
    const goods = await Goods.find({ openid }).sort({ updatedAt: -1 });
    res.json({ data: goods });
  } catch (error) {
    console.error('获取商品列表失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存商品列表
app.post('/api/goods', async (req, res) => {
  try {
    const { goodsList, openid } = req.body;
    if (!openid) {
      return res.status(400).json({ error: 'Missing openid' });
    }
    
    // 删除用户现有的商品
    await Goods.deleteMany({ openid });
    
    // 批量插入新商品
    if (goodsList && goodsList.length > 0) {
      const goodsToInsert = goodsList.map(good => ({
        ...good,
        openid
      }));
      await Goods.insertMany(goodsToInsert);
    }
    
    res.json({ message: 'Goods saved successfully' });
  } catch (error) {
    console.error('保存商品列表失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取配置
app.get('/api/config', async (req, res) => {
  try {
    const { openid } = req.query;
    if (!openid) {
      return res.status(400).json({ error: 'Missing openid' });
    }
    
    let config = await Config.findOne({ openid });
    if (!config) {
      // 如果没有配置，则创建默认配置
      config = new Config({ openid });
      await config.save();
    }
    
    res.json({ data: config });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存配置
app.post('/api/config', async (req, res) => {
  try {
    const { openid, ...configData } = req.body;
    if (!openid) {
      return res.status(400).json({ error: 'Missing openid' });
    }
    
    let config = await Config.findOne({ openid });
    if (config) {
      // 更新现有配置
      Object.assign(config, configData);
      config.updatedAt = new Date();
      await config.save();
    } else {
      // 创建新配置
      config = new Config({ ...configData, openid });
      await config.save();
    }
    
    res.json({ message: 'Config saved successfully' });
  } catch (error) {
    console.error('保存配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 图片上传
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // 返回文件访问路径
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// 提供上传文件的静态访问
app.use('/uploads', express.static('uploads'));

// 根路径
app.get('/', (req, res) => {
  res.json({ message: 'WeChat Mini Program Backend API' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});