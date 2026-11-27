/* 模拟外卖平台商家数据库 —— 10 家商家 / 44 道菜（1 家休息中） */

const MERCHANTS = [
  { id: 'xiangkou', name: '巷口小馆', category: '家常菜', rating: 4.7, distance: 1.2, minutes: 28, monthly: 3200, open: true, mark: '巷' },
  { id: 'chuancai', name: '川味小馆', category: '川湘菜', rating: 4.5, distance: 1.8, minutes: 32, monthly: 2800, open: true, mark: '川' },
  { id: 'shancheng', name: '山城小面', category: '面食', rating: 4.4, distance: 0.9, minutes: 25, monthly: 3600, open: true, mark: '山' },
  { id: 'helv', name: '禾绿轻食', category: '轻食沙拉', rating: 4.8, distance: 2.1, minutes: 35, monthly: 1900, open: true, mark: '禾' },
  { id: 'jinji', name: '锦记烧腊', category: '粤式烧腊', rating: 4.5, distance: 1.5, minutes: 30, monthly: 2400, open: true, mark: '锦' },
  { id: 'yifan', name: '一番屋', category: '日式简餐', rating: 4.6, distance: 1.1, minutes: 26, monthly: 3100, open: true, mark: '一' },
  { id: 'laoshan', name: '老陕面馆', category: '西北面食', rating: 4.4, distance: 0.7, minutes: 22, monthly: 2600, open: true, mark: '陕' },
  { id: 'xiaoman', name: '小满食堂', category: '蒸菜·家常', rating: 4.7, distance: 1.6, minutes: 30, monthly: 2100, open: true, mark: '满' },
  { id: 'hanwei', name: '韩味屋', category: '韩式料理', rating: 4.3, distance: 2.4, minutes: 38, monthly: 1700, open: true, mark: '韩' },
  { id: 'xiangli', name: '湘里人家', category: '湘菜', rating: 4.6, distance: 2.0, minutes: 40, monthly: 1500, open: false, mark: '湘' },
];

const DISHES = [
  {
    id: 'd1', merchantId: 'xiangkou', name: '番茄牛腩饭', emoji: '🍅', tone: 'tomato',
    desc: '牛腩炖到软烂，番茄汁拌饭很香。',
    cuisine: '家常菜', protein: '牛肉', main: '番茄牛腩', tastes: ['咸鲜', '酸甜'],
    ingredients: ['牛肉', '番茄', '土豆', '葱'], cooking: '炖', oil: 2, fried: false,
    staple: '米饭', price: 32, rating: 4.7, monthly: 860, minutes: 28,
  },
  {
    id: 'd2', merchantId: 'xiangkou', name: '香菇滑鸡饭', emoji: '🍄', tone: 'amber',
    desc: '香菇和鸡腿一起蒸，汁水都留在饭里。',
    cuisine: '家常菜', protein: '鸡肉', main: '香菇滑鸡', tastes: ['咸鲜'],
    ingredients: ['鸡腿肉', '香菇', '葱'], cooking: '蒸', oil: 1, fried: false,
    staple: '米饭', price: 28, rating: 4.6, monthly: 720, minutes: 27,
  },
  {
    id: 'd3', merchantId: 'xiangkou', name: '红烧排骨饭', emoji: '🍖', tone: 'cocoa',
    desc: '酱汁浓，排骨炖得脱骨，配两份青菜。',
    cuisine: '家常菜', protein: '猪肉', main: '红烧排骨', tastes: ['酱香'],
    ingredients: ['猪肋排', '冰糖', '葱姜'], cooking: '炖', oil: 2, fried: false,
    staple: '米饭', price: 34, rating: 4.5, monthly: 640, minutes: 30,
  },
  {
    id: 'd4', merchantId: 'xiangkou', name: '清蒸鲈鱼套餐', emoji: '🐟', tone: 'sky',
    desc: '整条鲈鱼现蒸，配一碗饭和时蔬。',
    cuisine: '家常菜', protein: '鱼虾', main: '清蒸鲈鱼', tastes: ['清淡'],
    ingredients: ['鲈鱼', '葱', '姜'], cooking: '蒸', oil: 1, fried: false,
    staple: '米饭', price: 42, rating: 4.8, monthly: 380, minutes: 32,
  },
  {
    id: 'd5', merchantId: 'xiangkou', name: '麻婆豆腐饭', emoji: '🌶️', tone: 'tomato',
    desc: '花椒味正，豆腐嫩，拌饭很下饭。',
    cuisine: '家常菜', protein: '豆制品', main: '麻婆豆腐', tastes: ['重辣', '咸鲜'],
    ingredients: ['豆腐', '肉末', '花椒', '葱'], cooking: '炒', oil: 2, fried: false,
    staple: '米饭', price: 22, rating: 4.4, monthly: 900, minutes: 24,
  },

  {
    id: 'd6', merchantId: 'chuancai', name: '水煮牛肉饭', emoji: '🥩', tone: 'tomato',
    desc: '红油厚、牛肉嫩，底下垫了豆芽。',
    cuisine: '川湘菜', protein: '牛肉', main: '水煮牛肉', tastes: ['重辣'],
    ingredients: ['牛肉', '豆芽', '辣椒', '蒜'], cooking: '煮', oil: 3, fried: false,
    staple: '米饭', price: 38, rating: 4.6, monthly: 780, minutes: 33,
  },
  {
    id: 'd7', merchantId: 'chuancai', name: '鱼香肉丝盖饭', emoji: '🥢', tone: 'clay',
    desc: '酸甜微辣，肉丝和木耳都给得足。',
    cuisine: '川湘菜', protein: '猪肉', main: '鱼香肉丝', tastes: ['酸甜', '微辣'],
    ingredients: ['猪里脊', '木耳', '胡萝卜', '蒜'], cooking: '炒', oil: 2, fried: false,
    staple: '米饭', price: 26, rating: 4.5, monthly: 950, minutes: 28,
  },
  {
    id: 'd8', merchantId: 'chuancai', name: '口水鸡饭', emoji: '🐔', tone: 'clay',
    desc: '红油香而不燥，鸡肉是凉的，适合没胃口的中午。',
    cuisine: '川湘菜', protein: '鸡肉', main: '口水鸡', tastes: ['重辣'],
    ingredients: ['鸡腿', '花生', '香菜', '蒜'], cooking: '拌', oil: 2, fried: false,
    staple: '米饭', price: 30, rating: 4.4, monthly: 610, minutes: 30,
  },
  {
    id: 'd9', merchantId: 'chuancai', name: '担担面', emoji: '🍜', tone: 'amber',
    desc: '麻酱和红油裹住面条，肉末给得大方。',
    cuisine: '川湘菜', protein: '猪肉', main: '担担面', tastes: ['微辣'],
    ingredients: ['面条', '肉末', '花生', '葱'], cooking: '煮', oil: 2, fried: false,
    staple: '面条', price: 24, rating: 4.5, monthly: 830, minutes: 26,
  },
  {
    id: 'd10', merchantId: 'chuancai', name: '麻辣香锅', emoji: '🌶️', tone: 'tomato',
    desc: '自选四样配菜，重口但过瘾。',
    cuisine: '川湘菜', protein: '其他', main: '麻辣香锅', tastes: ['重辣'],
    ingredients: ['午餐肉', '藕片', '花菜', '蒜'], cooking: '炒', oil: 3, fried: false,
    staple: '米饭', price: 44, rating: 4.5, monthly: 1200, minutes: 35,
  },

  {
    id: 'd11', merchantId: 'shancheng', name: '红烧牛肉面', emoji: '🍜', tone: 'clay',
    desc: '大块牛肉，汤头偏川式，微辣开胃。',
    cuisine: '面食', protein: '牛肉', main: '红烧牛肉', tastes: ['咸鲜', '微辣'],
    ingredients: ['牛肉', '面条', '葱'], cooking: '炖', oil: 2, fried: false,
    staple: '面条', price: 30, rating: 4.6, monthly: 1100, minutes: 25,
  },
  {
    id: 'd12', merchantId: 'shancheng', name: '豌杂面', emoji: '🍜', tone: 'amber',
    desc: '豌豆软糯，杂酱咸香，拌开最好吃。',
    cuisine: '面食', protein: '猪肉', main: '豌杂面', tastes: ['咸鲜', '微辣'],
    ingredients: ['豌豆', '肉末', '葱蒜'], cooking: '煮', oil: 2, fried: false,
    staple: '面条', price: 22, rating: 4.4, monthly: 760, minutes: 23,
  },
  {
    id: 'd13', merchantId: 'shancheng', name: '酸辣粉', emoji: '🍲', tone: 'tomato',
    desc: '酸得够劲，辣得直接，粉很有嚼头。',
    cuisine: '面食', protein: '猪肉', main: '酸辣粉', tastes: ['酸甜', '重辣'],
    ingredients: ['红薯粉', '肉末', '辣椒', '醋'], cooking: '煮', oil: 2, fried: false,
    staple: '粉', price: 18, rating: 4.4, monthly: 980, minutes: 22,
  },
  {
    id: 'd14', merchantId: 'shancheng', name: '清汤抄手', emoji: '🥟', tone: 'sage',
    desc: '骨汤打底，抄手皮薄馅足，清淡不寡。',
    cuisine: '面食', protein: '猪肉', main: '清汤抄手', tastes: ['清淡'],
    ingredients: ['猪肉', '面粉', '葱'], cooking: '煮', oil: 1, fried: false,
    staple: '面点', price: 20, rating: 4.6, monthly: 540, minutes: 24,
  },
  {
    id: 'd15', merchantId: 'shancheng', name: '肥肠面', emoji: '🍜', tone: 'tomato',
    desc: '肥肠处理得干净，红汤浓，香菜给得足。',
    cuisine: '面食', protein: '猪肉', main: '肥肠面', tastes: ['咸鲜', '微辣'],
    ingredients: ['肥肠', '面条', '香菜', '蒜'], cooking: '炖', oil: 2, fried: false,
    staple: '面条', price: 28, rating: 4.3, monthly: 420, minutes: 27,
  },

  {
    id: 'd16', merchantId: 'helv', name: '香煎鸡胸藜麦碗', emoji: '🥗', tone: 'sage',
    desc: '鸡胸煎得嫩，藜麦和西兰花管饱。',
    cuisine: '轻食', protein: '鸡肉', main: '香煎鸡胸', tastes: ['咸鲜', '清淡'],
    ingredients: ['鸡胸肉', '藜麦', '西兰花', '玉米'], cooking: '煎', oil: 1, fried: false,
    staple: '藜麦饭', price: 39, rating: 4.8, monthly: 460, minutes: 33,
  },
  {
    id: 'd17', merchantId: 'helv', name: '三文鱼牛油果饭', emoji: '🍣', tone: 'sage',
    desc: '炙烤三文鱼配牛油果，轻食里的高配。',
    cuisine: '轻食', protein: '鱼虾', main: '炙烤三文鱼', tastes: ['清淡', '酱香'],
    ingredients: ['三文鱼', '牛油果', '海苔'], cooking: '烤', oil: 1, fried: false,
    staple: '米饭', price: 48, rating: 4.8, monthly: 320, minutes: 36,
  },
  {
    id: 'd18', merchantId: 'helv', name: '照烧豆腐时蔬碗', emoji: '🥦', tone: 'sage',
    desc: '豆腐外焦里嫩，糙米饭配三种时蔬。',
    cuisine: '轻食', protein: '豆制品', main: '照烧豆腐', tastes: ['酱香'],
    ingredients: ['豆腐', '西兰花', '胡萝卜'], cooking: '煎', oil: 2, fried: false,
    staple: '糙米饭', price: 32, rating: 4.7, monthly: 390, minutes: 30,
  },
  {
    id: 'd19', merchantId: 'helv', name: '鸡肉凯撒沙拉', emoji: '🥗', tone: 'sage',
    desc: '罗马生菜、鸡胸和全麦面包丁，酱汁另装。',
    cuisine: '轻食', protein: '鸡肉', main: '凯撒沙拉', tastes: ['清淡'],
    ingredients: ['鸡胸肉', '生菜', '芝士', '面包'], cooking: '拌', oil: 1, fried: false,
    staple: '全麦面包', price: 36, rating: 4.6, monthly: 280, minutes: 28,
  },
  {
    id: 'd20', merchantId: 'helv', name: '番茄虾仁意面', emoji: '🍝', tone: 'tomato',
    desc: '番茄底味清爽，虾仁弹牙，不厚重。',
    cuisine: '轻食', protein: '鱼虾', main: '番茄虾仁意面', tastes: ['酸甜'],
    ingredients: ['虾仁', '番茄', '洋葱'], cooking: '煮', oil: 1, fried: false,
    staple: '意面', price: 40, rating: 4.5, monthly: 350, minutes: 34,
  },

  {
    id: 'd21', merchantId: 'jinji', name: '蜜汁叉烧饭', emoji: '🍖', tone: 'cocoa',
    desc: '叉烧边角微焦，蜜汁甜咸，配靓汤。',
    cuisine: '粤式', protein: '猪肉', main: '蜜汁叉烧', tastes: ['酸甜', '酱香'],
    ingredients: ['猪梅花肉', '蜂蜜'], cooking: '烤', oil: 2, fried: false,
    staple: '米饭', price: 32, rating: 4.6, monthly: 900, minutes: 28,
  },
  {
    id: 'd22', merchantId: 'jinji', name: '白切鸡饭', emoji: '🐔', tone: 'amber',
    desc: '鸡有鸡味，姜葱酱是灵魂，米饭油润。',
    cuisine: '粤式', protein: '鸡肉', main: '白切鸡', tastes: ['清淡', '咸鲜'],
    ingredients: ['三黄鸡', '葱姜'], cooking: '煮', oil: 1, fried: false,
    staple: '米饭', price: 30, rating: 4.5, monthly: 680, minutes: 29,
  },
  {
    id: 'd23', merchantId: 'jinji', name: '烧鸭拼油鸡饭', emoji: '🦆', tone: 'cocoa',
    desc: '双拼烧味，烧鸭皮脆，油鸡滑。',
    cuisine: '粤式', protein: '其他', main: '烧鸭油鸡', tastes: ['酱香'],
    ingredients: ['鸭肉', '鸡'], cooking: '烤', oil: 2, fried: false,
    staple: '米饭', price: 36, rating: 4.5, monthly: 520, minutes: 32,
  },
  {
    id: 'd24', merchantId: 'jinji', name: '豉汁蒸排骨饭', emoji: '🍖', tone: 'clay',
    desc: '排骨嫩，豉汁咸鲜，蒸出来的不油。',
    cuisine: '粤式', protein: '猪肉', main: '豉汁蒸排骨', tastes: ['咸鲜'],
    ingredients: ['排骨', '豆豉', '蒜'], cooking: '蒸', oil: 1, fried: false,
    staple: '米饭', price: 30, rating: 4.6, monthly: 610, minutes: 30,
  },
  {
    id: 'd25', merchantId: 'jinji', name: '腊味煲仔饭', emoji: '🍚', tone: 'cocoa',
    desc: '腊肠腊肉铺满，锅底有锅巴，酱汁偏甜。',
    cuisine: '粤式', protein: '猪肉', main: '腊味煲仔饭', tastes: ['酱香'],
    ingredients: ['腊肠', '腊肉', '葱'], cooking: '焖', oil: 2, fried: false,
    staple: '米饭', price: 34, rating: 4.7, monthly: 740, minutes: 33,
  },

  {
    id: 'd26', merchantId: 'yifan', name: '照烧鸡腿饭', emoji: '🍗', tone: 'cocoa',
    desc: '鸡腿煎过再裹照烧汁，甜咸下饭。',
    cuisine: '日式', protein: '鸡肉', main: '照烧鸡腿', tastes: ['酱香', '酸甜'],
    ingredients: ['鸡腿', '酱油', '葱'], cooking: '煎', oil: 2, fried: false,
    staple: '米饭', price: 32, rating: 4.6, monthly: 1200, minutes: 26,
  },
  {
    id: 'd27', merchantId: 'yifan', name: '三文鱼刺身定食', emoji: '🍣', tone: 'sky',
    desc: '厚切三文鱼，配米饭、味增汤和小菜。',
    cuisine: '日式', protein: '鱼虾', main: '三文鱼刺身', tastes: ['清淡'],
    ingredients: ['三文鱼', '芥末'], cooking: '生', oil: 1, fried: false,
    staple: '米饭', price: 52, rating: 4.7, monthly: 300, minutes: 30,
  },
  {
    id: 'd28', merchantId: 'yifan', name: '牛肉咖喱饭', emoji: '🍛', tone: 'amber',
    desc: '日式咖喱微辣，土豆胡萝卜炖得入味。',
    cuisine: '日式', protein: '牛肉', main: '牛肉咖喱', tastes: ['咖喱', '微辣'],
    ingredients: ['牛肉', '咖喱', '洋葱', '胡萝卜'], cooking: '炖', oil: 2, fried: false,
    staple: '米饭', price: 36, rating: 4.5, monthly: 860, minutes: 28,
  },
  {
    id: 'd29', merchantId: 'yifan', name: '亲子丼', emoji: '🍲', tone: 'sage',
    desc: '滑蛋半熟，鸡肉嫩，酱汁甜咸适中。',
    cuisine: '日式', protein: '鸡肉', main: '亲子丼', tastes: ['咸鲜', '酸甜'],
    ingredients: ['鸡腿', '鸡蛋', '洋葱', '葱'], cooking: '煮', oil: 1, fried: false,
    staple: '米饭', price: 30, rating: 4.6, monthly: 720, minutes: 25,
  },
  {
    id: 'd30', merchantId: 'yifan', name: '天妇罗乌冬', emoji: '🍤', tone: 'sky',
    desc: '两只大虾天妇罗，乌冬汤底清爽。',
    cuisine: '日式', protein: '鱼虾', main: '天妇罗乌冬', tastes: ['清淡'],
    ingredients: ['虾', '面粉', '葱'], cooking: '炸', oil: 3, fried: true,
    staple: '乌冬', price: 38, rating: 4.4, monthly: 410, minutes: 32,
  },

  {
    id: 'd31', merchantId: 'laoshan', name: '油泼面', emoji: '🍜', tone: 'clay',
    desc: '宽面泼热油，辣子和蒜香一起上来。',
    cuisine: '西北', protein: '其他', main: '油泼面', tastes: ['咸鲜', '重辣'],
    ingredients: ['面粉', '辣椒', '葱蒜'], cooking: '煮', oil: 3, fried: false,
    staple: '面条', price: 20, rating: 4.3, monthly: 890, minutes: 22,
  },
  {
    id: 'd32', merchantId: 'laoshan', name: '腊汁肉夹馍', emoji: '🥙', tone: 'cocoa',
    desc: '白吉馍烤得酥，腊汁肉肥瘦相间。',
    cuisine: '西北', protein: '猪肉', main: '腊汁肉夹馍', tastes: ['酱香'],
    ingredients: ['猪肉', '面粉'], cooking: '卤', oil: 2, fried: false,
    staple: '白吉馍', price: 16, rating: 4.4, monthly: 1100, minutes: 20,
  },
  {
    id: 'd33', merchantId: 'laoshan', name: '臊子面', emoji: '🍜', tone: 'amber',
    desc: '酸香开胃，臊子料足，汤可以喝。',
    cuisine: '西北', protein: '猪肉', main: '臊子面', tastes: ['酸甜', '微辣'],
    ingredients: ['猪肉', '木耳', '胡萝卜', '鸡蛋'], cooking: '煮', oil: 2, fried: false,
    staple: '面条', price: 22, rating: 4.4, monthly: 630, minutes: 24,
  },
  {
    id: 'd34', merchantId: 'laoshan', name: '牛肉泡馍', emoji: '🍲', tone: 'clay',
    desc: '馍掰得小，牛肉汤浓，香菜和辣酱自加。',
    cuisine: '西北', protein: '牛肉', main: '牛肉泡馍', tastes: ['咸鲜'],
    ingredients: ['牛肉', '粉丝', '葱', '香菜'], cooking: '煮', oil: 2, fried: false,
    staple: '馍', price: 30, rating: 4.5, monthly: 580, minutes: 26,
  },

  {
    id: 'd35', merchantId: 'xiaoman', name: '豉汁蒸鸡饭', emoji: '🐔', tone: 'amber',
    desc: '现蒸的鸡，肉嫩汁清，米饭吸满鸡汁。',
    cuisine: '家常菜', protein: '鸡肉', main: '豉汁蒸鸡', tastes: ['咸鲜'],
    ingredients: ['鸡', '豆豉', '葱'], cooking: '蒸', oil: 1, fried: false,
    staple: '米饭', price: 27, rating: 4.7, monthly: 650, minutes: 30,
  },
  {
    id: 'd36', merchantId: 'xiaoman', name: '冬瓜排骨汤套餐', emoji: '🍲', tone: 'sage',
    desc: '汤清不油，配米饭和一碟青菜。',
    cuisine: '家常菜', protein: '猪肉', main: '冬瓜排骨汤', tastes: ['清淡'],
    ingredients: ['冬瓜', '排骨', '葱'], cooking: '炖', oil: 1, fried: false,
    staple: '米饭', price: 29, rating: 4.7, monthly: 480, minutes: 32,
  },
  {
    id: 'd37', merchantId: 'xiaoman', name: '梅菜扣肉饭', emoji: '🍖', tone: 'cocoa',
    desc: '梅干菜吸油，五花肉入口即化，偏咸。',
    cuisine: '家常菜', protein: '猪肉', main: '梅菜扣肉', tastes: ['咸鲜', '酱香'],
    ingredients: ['五花肉', '梅干菜'], cooking: '蒸', oil: 3, fried: false,
    staple: '米饭', price: 33, rating: 4.5, monthly: 520, minutes: 34,
  },
  {
    id: 'd38', merchantId: 'xiaoman', name: '番茄炒蛋饭', emoji: '🍅', tone: 'tomato',
    desc: '汤汁多，鸡蛋嫩，最朴素的下饭菜。',
    cuisine: '家常菜', protein: '蛋', main: '番茄炒蛋', tastes: ['酸甜', '咸鲜'],
    ingredients: ['番茄', '鸡蛋', '葱'], cooking: '炒', oil: 2, fried: false,
    staple: '米饭', price: 20, rating: 4.6, monthly: 1400, minutes: 22,
  },
  {
    id: 'd39', merchantId: 'xiaoman', name: '虾仁滑蛋饭', emoji: '🍤', tone: 'amber',
    desc: '虾仁脆、滑蛋嫩，咸鲜口，配米饭刚好。',
    cuisine: '家常菜', protein: '鱼虾', main: '虾仁滑蛋', tastes: ['咸鲜'],
    ingredients: ['虾仁', '鸡蛋', '葱'], cooking: '炒', oil: 2, fried: false,
    staple: '米饭', price: 34, rating: 4.6, monthly: 780, minutes: 28,
  },

  {
    id: 'd40', merchantId: 'hanwei', name: '石锅拌饭', emoji: '🍚', tone: 'tomato',
    desc: '石锅底有锅巴，拌开辣酱很香。',
    cuisine: '韩式', protein: '牛肉', main: '石锅拌饭', tastes: ['咸鲜', '微辣'],
    ingredients: ['牛肉', '鸡蛋', '蔬菜'], cooking: '拌', oil: 2, fried: false,
    staple: '米饭', price: 33, rating: 4.5, monthly: 700, minutes: 32,
  },
  {
    id: 'd41', merchantId: 'hanwei', name: '部队锅', emoji: '🍲', tone: 'tomato',
    desc: '午餐肉、芝士和泡面一锅煮，重口满足。',
    cuisine: '韩式', protein: '其他', main: '部队锅', tastes: ['重辣'],
    ingredients: ['午餐肉', '香肠', '芝士', '泡面'], cooking: '煮', oil: 2, fried: false,
    staple: '米饭', price: 42, rating: 4.3, monthly: 380, minutes: 36,
  },
  {
    id: 'd42', merchantId: 'hanwei', name: '韩式炸鸡饭', emoji: '🍗', tone: 'cocoa',
    desc: '甜辣酱裹炸鸡，热量高但快乐。',
    cuisine: '韩式', protein: '鸡肉', main: '韩式炸鸡', tastes: ['酸甜', '重辣'],
    ingredients: ['鸡腿', '面粉', '辣椒'], cooking: '炸', oil: 3, fried: true,
    staple: '米饭', price: 38, rating: 4.2, monthly: 500, minutes: 34,
  },

  {
    id: 'd43', merchantId: 'xiangli', name: '小炒黄牛肉', emoji: '🥘', tone: 'tomato',
    desc: '鲜辣猛火，牛肉嫩，店里今天休息。',
    cuisine: '川湘菜', protein: '牛肉', main: '小炒黄牛肉', tastes: ['重辣'],
    ingredients: ['牛肉', '辣椒', '蒜'], cooking: '炒', oil: 3, fried: false,
    staple: '米饭', price: 38, rating: 4.6, monthly: 600, minutes: 38,
  },
  {
    id: 'd44', merchantId: 'xiangli', name: '剁椒鱼头饭', emoji: '🐟', tone: 'tomato',
    desc: '剁椒鲜辣，鱼头现蒸，店里今天休息。',
    cuisine: '川湘菜', protein: '鱼虾', main: '剁椒鱼头', tastes: ['重辣'],
    ingredients: ['鱼头', '剁椒'], cooking: '蒸', oil: 2, fried: false,
    staple: '米饭', price: 42, rating: 4.5, monthly: 300, minutes: 42,
  },
];

const TASTE_OPTIONS = ['咸鲜', '微辣', '重辣', '清淡', '酸甜', '酱香', '咖喱'];

const AVOID_OPTIONS = [
  { id: 'cilantro', label: '香菜', terms: ['香菜'] },
  { id: 'allium', label: '葱蒜', terms: ['葱', '蒜', '洋葱', '葱姜'] },
  { id: 'organ', label: '内脏', terms: ['内脏', '肥肠', '猪肝', '毛肚', '鸭血'] },
  { id: 'seafood', label: '海鲜', terms: ['虾', '鱼', '蟹', '蛤蜊', '鱿鱼', '海鲜'] },
  { id: 'peanut', label: '花生坚果', terms: ['花生', '腰果', '坚果'] },
  { id: 'dairy', label: '乳制品', terms: ['芝士', '牛奶', '奶油', '黄油'] },
  { id: 'beef', label: '牛肉', terms: ['牛肉', '牛腩', '牛柳', '肥牛'] },
  { id: 'pork', label: '猪肉', terms: ['猪肉', '排骨', '叉烧', '腊肠', '腊肉', '五花肉', '里脊', '肉末', '午餐肉', '香肠', '猪'] },
];

const DEFAULT_PROFILE = {
  tastes: ['咸鲜', '微辣'],
  avoid: ['cilantro', 'organ'],
  healthy: true,
  staplePriority: true,
  budget: 45,
};

/* 演示初始记忆：昨天 / 前天各吃过一道，用来展示“不重样”规则 */
const SEED_HISTORY = [
  { dishId: 'd26', dayIndex: -1 },
  { dishId: 'd28', dayIndex: -2 },
];
