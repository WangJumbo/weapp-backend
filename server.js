const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB 连接
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/weapp';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// 数据库模式 - 商品现在是全局的，不再按用户存储
const GoodsSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  score: { type: Number, required: true },
  desc: { type: String, required: true },
  image: { type: String, required: true }, // 存储Base64编码的图片
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// 配置信息使用全局ID存储
const ConfigSchema = new mongoose.Schema({
  id: { type: String, default: 'global_config', unique: true }, // 固定ID
  bannerImage: { type: String, default: "/images/banner.png" }, // 存储Base64编码的图片
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

// 辅助函数：验证是否为Base64图片格式
function isBase64Image(str) {
  return typeof str === 'string' && str.startsWith('data:image/');
}

// 辅助函数：清理非Base64格式的图片URL
function cleanImageURL(url) {
  if (isBase64Image(url)) {
    return url; // 已经是Base64格式，直接返回
  }
  // 如果不是Base64格式，返回默认图片
  return "/images/goods/default_goods.png";
}

// API 路由

// 获取所有商品列表（全局）- 修正：按ID排序以保持顺序
app.get('/api/goods', async (req, res) => {
  try {
    // 修正：按ID排序，确保保持用户自定义顺序
    const goods = await Goods.find().sort({ createdAt: 1 });
    // 修正：确保返回的图片都是Base64格式
    const processedGoods = goods.map(good => {
      const cleanedGood = good.toObject();
      cleanedGood.image = cleanImageURL(cleanedGood.image);
      return cleanedGood;
    });
    res.json({ data: processedGoods });
  } catch (error) {
    console.error('获取商品列表失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存商品列表（全局）- 修正：验证图片格式
app.post('/api/goods', async (req, res) => {
  try {
    const { goodsList } = req.body;
    
    // 清空所有现有商品
    await Goods.deleteMany({});
    
    // 批量插入新商品，确保图片是Base64格式
    if (goodsList && goodsList.length > 0) {
      const processedGoodsList = goodsList.map(good => ({
        ...good,
        image: isBase64Image(good.image) ? good.image : cleanImageURL(good.image),
        updatedAt: new Date()
      }));
      await Goods.insertMany(processedGoodsList);
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
    
    // 只返回需要的配置，不返回管理相关字段（如果有的话）
    let { bannerImage, bannerTitle, ruleList, updatedAt } = config.toObject();
    // 修正：确保返回的图片都是Base64格式
    bannerImage = isBase64Image(bannerImage) ? bannerImage : cleanImageURL(bannerImage);
    
    res.json({ data: { bannerImage, bannerTitle, ruleList, updatedAt } });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存全局配置（需要管理员权限，这里简化处理）
app.post('/api/config', async (req, res) => {
  try {
    const { bannerImage, bannerTitle, ruleList } = req.body;
    
    let config = await Config.findOne({ id: 'global_config' });
    if (config) {
      // 更新现有配置
      // 修正：确保图片是Base64格式
      if (bannerImage !== undefined) config.bannerImage = isBase64Image(bannerImage) ? bannerImage : cleanImageURL(bannerImage);
      if (bannerTitle !== undefined) config.bannerTitle = bannerTitle;
      if (ruleList !== undefined) config.ruleList = ruleList;
      config.updatedAt = new Date();
      await config.save();
    } else {
      // 创建新配置
      config = new Config({
        id: 'global_config',
        bannerImage: isBase64Image(bannerImage) ? bannerImage : cleanImageURL(bannerImage),
        bannerTitle,
        ruleList
      });
      await config.save();
    }
    
    res.json({ message: 'Config saved successfully' });
  } catch (error) {
    console.error('保存配置失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 图片上传 - 现在将图片转换为Base64存储
app.post('/api/upload', (req, res) => {
  // 检查是否有文件上传
  if (!req.headers['content-type'] || !req.headers['content-type'].startsWith('multipart/form-data')) {
    return res.status(400).json({ error: 'Please upload as form data' });
  }

  // 使用multer中间件处理文件上传
  const upload = multer({ 
    limits: { fileSize: 5 * 1024 * 1024 } // 限制文件大小为5MB
  }).single('image');

  upload(req, res, (err) => {
    if (err) {
      console.error('File upload error:', err);
      return res.status(500).json({ error: 'File upload error' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 将上传的文件转换为Base64编码
    const base64Data = req.file.buffer.toString('base64');
    const ext = path.extname(req.file.originalname).substring(1);
    const base64Image = `data:image/${ext};base64,${base64Data}`;
    
    // 返回Base64编码的图片
    res.json({ url: base64Image });
  });
});

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