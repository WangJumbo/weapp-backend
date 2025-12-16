const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB 连接 - 使用环境变量，如果没有设置则使用本地默认值
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/weapp';
console.log('Connecting to MongoDB:', MONGODB_URI);

// 设置数据库连接选项 - 移除不支持的选项
const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // 等待服务器选择的时间
    });
    console.log('MongoDB connected successfully');
    
    // 确保初始配置存在
    const config = await Config.findOne({ id: 'global_config' });
    if (!config) {
      const initialConfig = new Config({ id: 'global_config' });
      await initialConfig.save();
      console.log('Initial config created with default password: 123456');
    }
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1); // 连接失败时退出进程
  }
};

// 连接数据库
connectDB();

// 数据库模式
const GoodsSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  score: { type: Number, required: true },
  desc: { type: String, required: true },
  image: { type: String, required: true },
  openid: { type: String, required: true }, // 按用户存储商品
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 配置信息使用全局ID存储
const ConfigSchema = new mongoose.Schema({
  id: { type: String, default: 'global_config', unique: true }, // 固定ID
  bannerImage: { type: String, default: "/images/banner.png" },
  bannerTitle: { type: String, default: "萌宠好礼 积分兑换" },
  ruleList: { type: [String], default: [
    "每消费1元可获得1积分，积分永久有效",
    "兑换商品需满足积分数量，积分扣除后不可退回",
    "商品数量有限，兑完即止，不设退换",
    "最终解释权归喜饼宠物所有"
  ]},
  adminPassword: { type: String, default: "123456" }, // 管理员密码
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

// 获取商品列表（按用户）
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

// 保存商品列表（按用户）
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

// 获取全局配置
app.get('/api/config', async (req, res) => {
  try {
    // 不需要openid，获取全局配置
    let config = await Config.findOne({ id: 'global_config' });
    if (!config) {
      // 如果没有全局配置，则创建默认配置
      config = new Config({ id: 'global_config' });
      await config.save();
    }
    
    // 只返回需要的配置，不返回密码
    const { bannerImage, bannerTitle, ruleList, updatedAt } = config.toObject();
    res.json({ data: { bannerImage, bannerTitle, ruleList, updatedAt } });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 获取完整配置（包括密码）- 需要管理员权限
app.post('/api/admin/config', async (req, res) => {
  try {
    const { adminPwd } = req.body;
    
    // 这里可以实现管理员验证逻辑，为简化，我们直接验证密码
    const config = await Config.findOne({ id: 'global_config' });
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    // 验证管理员密码
    if (adminPwd !== config.adminPassword) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    // 返回完整配置（包括密码）
    res.json({ data: config });
  } catch (error) {
    console.error('获取完整配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存全局配置（需要管理员权限）
app.post('/api/admin/config', async (req, res) => {
  try {
    const { adminPwd, bannerImage, bannerTitle, ruleList, newAdminPassword } = req.body;
    
    // 验证管理员密码
    const config = await Config.findOne({ id: 'global_config' });
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    
    if (adminPwd !== config.adminPassword) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    // 更新配置
    if (bannerImage !== undefined) config.bannerImage = bannerImage;
    if (bannerTitle !== undefined) config.bannerTitle = bannerTitle;
    if (ruleList !== undefined) config.ruleList = ruleList;
    if (newAdminPassword !== undefined && newAdminPassword.trim() !== '') {
      config.adminPassword = newAdminPassword;
    }
    config.updatedAt = new Date();
    await config.save();
    
    res.json({ message: 'Config saved successfully' });
  } catch (error) {
    console.error('保存配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 重置密码的特殊端点（仅用于恢复访问）
app.post('/api/reset-password', async (req, res) => {
  try {
    const { secret } = req.body;
    
    // 这里使用一个秘密密钥来重置密码（仅在紧急情况下使用）
    const RESET_SECRET = process.env.RESET_SECRET || 'reset_secret_123456';
    if (secret !== RESET_SECRET) {
      return res.status(401).json({ error: 'Invalid reset secret' });
    }
    
    // 重置密码为默认值
    let config = await Config.findOne({ id: 'global_config' });
    if (!config) {
      config = new Config({ id: 'global_config' });
    }
    
    config.adminPassword = '123456'; // 重置为默认密码
    await config.save();
    
    res.json({ message: 'Password reset to default successfully' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({ error: 'Password reset failed' });
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

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});