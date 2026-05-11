const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "暴雨内涝下城市道路交通预演与韧性评估";
pres.author = "张庭瑞";

// Color palette - deep blue/teal theme for urban traffic resilience
const colors = {
  primary: "0D4F6E",      // Deep teal
  secondary: "1A7F9E",   // Medium teal
  accent: "2EB8D5",      // Light teal/cyan
  dark: "0A3A52",        // Very dark teal
  light: "E8F4F8",       // Light blue-gray
  white: "FFFFFF",
  text: "2C3E50",
  gray: "7F8C8D"
};

// Shadow factory to avoid mutation issues
const makeShadow = () => ({
  type: "outer",
  color: "000000",
  blur: 8,
  offset: 3,
  angle: 135,
  opacity: 0.2
});

// ============================================
// Slide 1: Title Slide
// ============================================
let slide1 = pres.addSlide();
slide1.background = { color: colors.dark };

// Decorative shape - large circle top right
slide1.addShape(pres.shapes.OVAL, {
  x: 6.5, y: -1.5, w: 5, h: 5,
  fill: { color: colors.secondary, transparency: 70 }
});

// Decorative shape - small circle bottom left
slide1.addShape(pres.shapes.OVAL, {
  x: -1, y: 4, w: 3, h: 3,
  fill: { color: colors.accent, transparency: 60 }
});

// Main title
slide1.addText("暴雨内涝下城市道路交通\n预演与韧性评估", {
  x: 0.5, y: 1.5, w: 9, h: 2,
  fontSize: 40, fontFace: "Arial", bold: true,
  color: colors.white, align: "center", valign: "middle",
  lineSpacingMultiple: 1.3
});

// Subtitle line
slide1.addShape(pres.shapes.RECTANGLE, {
  x: 3.5, y: 3.6, w: 3, h: 0.05,
  fill: { color: colors.accent }
});

// Author info
slide1.addText("张庭瑞 | 武汉理工大学 | 交通与物流工程学院", {
  x: 0.5, y: 4, w: 9, h: 0.5,
  fontSize: 16, fontFace: "Arial",
  color: colors.accent, align: "center"
});

// Course info
slide1.addText("交通应急管控与实践大作业", {
  x: 0.5, y: 4.8, w: 9, h: 0.4,
  fontSize: 14, fontFace: "Arial",
  color: colors.gray, align: "center"
});

// ============================================
// Slide 2: 研究背景
// ============================================
let slide2 = pres.addSlide();
slide2.background = { color: colors.white };

// Header bar
slide2.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1.1,
  fill: { color: colors.primary }
});

// Title
slide2.addText("研究背景", {
  x: 0.5, y: 0.25, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Arial", bold: true,
  color: colors.white, margin: 0
});

// Left column - Problem description
slide2.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 0.4, y: 1.4, w: 4.4, h: 3.9,
  fill: { color: colors.light },
  rectRadius: 0.1
});

slide2.addText("问题背景", {
  x: 0.6, y: 1.55, w: 4, h: 0.5,
  fontSize: 18, fontFace: "Arial", bold: true,
  color: colors.primary, margin: 0
});

slide2.addText([
  { text: "暴雨内涝突发性强、危害性大、影响范围广", options: { bullet: true, breakLine: true } },
  { text: "'城市看海'现象频发：广州'5·22'、郑州'7·20'等", options: { bullet: true, breakLine: true } },
  { text: "当前预案缺乏历史数据支撑、针对性不足", options: { bullet: true, breakLine: true } },
  { text: "习近平总书记要求健全应急预案机制", options: { bullet: true } }
], {
  x: 0.6, y: 2.15, w: 4, h: 2.9,
  fontSize: 13, fontFace: "Arial",
  color: colors.text, valign: "top"
});

// Right column - Research objective
slide2.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 5.2, y: 1.4, w: 4.4, h: 3.9,
  fill: { color: colors.primary },
  rectRadius: 0.1
});

slide2.addText("研究目标", {
  x: 5.4, y: 1.55, w: 4, h: 0.5,
  fontSize: 18, fontFace: "Arial", bold: true,
  color: colors.accent, margin: 0
});

slide2.addText([
  { text: "耦合内涝与交通协同仿真，推演不同强度暴雨内涝下交通演变", options: { bullet: true, breakLine: true } },
  { text: "改进介数中心性模型，评估路网韧性变化", options: { bullet: true, breakLine: true } },
  { text: "构建GCN-CapsNet预测模型，实现韧性快速评估", options: { bullet: true, breakLine: true } },
  { text: "开发城市道路交通预演与韧性评估系统", options: { bullet: true } }
], {
  x: 5.4, y: 2.15, w: 4, h: 2.9,
  fontSize: 13, fontFace: "Arial",
  color: colors.white, valign: "top"
});

// ============================================
// Slide 3: 研究方法
// ============================================
let slide3 = pres.addSlide();
slide3.background = { color: colors.white };

// Header bar
slide3.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1.1,
  fill: { color: colors.primary }
});

// Title
slide3.addText("研究方法", {
  x: 0.5, y: 0.25, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Arial", bold: true,
  color: colors.white, margin: 0
});

// Three-column layout for methods
const methodBoxWidth = 2.8;
const methodGap = 0.3;
const methodStartX = 0.5;

// Method 1: Coupling simulation
slide3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: methodStartX, y: 1.4, w: methodBoxWidth, h: 3.9,
  fill: { color: colors.white },
  line: { color: colors.primary, width: 2 },
  rectRadius: 0.1,
  shadow: makeShadow()
});

slide3.addShape(pres.shapes.OVAL, {
  x: methodStartX + 0.9, y: 1.6, w: 1, h: 1,
  fill: { color: colors.primary }
});

slide3.addText("1", {
  x: methodStartX + 0.9, y: 1.75, w: 1, h: 0.7,
  fontSize: 28, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide3.addText("内涝交通耦合仿真", {
  x: methodStartX + 0.1, y: 2.75, w: methodBoxWidth - 0.2, h: 0.5,
  fontSize: 14, fontFace: "Arial", bold: true,
  color: colors.primary, align: "center"
});

slide3.addText([
  { text: "SWMM管网模型", options: { bullet: true, breakLine: true } },
  { text: "WCA2D地表径流", options: { bullet: true, breakLine: true } },
  { text: "交通仿真 (限速/限行)", options: { bullet: true, breakLine: true } },
  { text: "动态耦合反馈机制", options: { bullet: true } }
], {
  x: methodStartX + 0.15, y: 3.35, w: methodBoxWidth - 0.3, h: 1.8,
  fontSize: 11, fontFace: "Arial",
  color: colors.text
});

// Method 2: Resilience evaluation
const method2X = methodStartX + methodBoxWidth + methodGap;
slide3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: method2X, y: 1.4, w: methodBoxWidth, h: 3.9,
  fill: { color: colors.white },
  line: { color: colors.secondary, width: 2 },
  rectRadius: 0.1,
  shadow: makeShadow()
});

slide3.addShape(pres.shapes.OVAL, {
  x: method2X + 0.9, y: 1.6, w: 1, h: 1,
  fill: { color: colors.secondary }
});

slide3.addText("2", {
  x: method2X + 0.9, y: 1.75, w: 1, h: 0.7,
  fontSize: 28, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide3.addText("路网韧性评估", {
  x: method2X + 0.1, y: 2.75, w: methodBoxWidth - 0.2, h: 0.5,
  fontSize: 14, fontFace: "Arial", bold: true,
  color: colors.secondary, align: "center"
});

slide3.addText([
  { text: "改进介数中心性模型", options: { bullet: true, breakLine: true } },
  { text: "最短时间路径加权", options: { bullet: true, breakLine: true } },
  { text: "流量加权改进", options: { bullet: true, breakLine: true } },
  { text: "路段重要性错位评估", options: { bullet: true } }
], {
  x: method2X + 0.15, y: 3.35, w: methodBoxWidth - 0.3, h: 1.8,
  fontSize: 11, fontFace: "Arial",
  color: colors.text
});

// Method 3: Deep learning prediction
const method3X = method2X + methodBoxWidth + methodGap;
slide3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: method3X, y: 1.4, w: methodBoxWidth, h: 3.9,
  fill: { color: colors.white },
  line: { color: colors.accent, width: 2 },
  rectRadius: 0.1,
  shadow: makeShadow()
});

slide3.addShape(pres.shapes.OVAL, {
  x: method3X + 0.9, y: 1.6, w: 1, h: 1,
  fill: { color: colors.accent }
});

slide3.addText("3", {
  x: method3X + 0.9, y: 1.75, w: 1, h: 0.7,
  fontSize: 28, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide3.addText("深度学习预测", {
  x: method3X + 0.1, y: 2.75, w: methodBoxWidth - 0.2, h: 0.5,
  fontSize: 14, fontFace: "Arial", bold: true,
  color: colors.dark, align: "center"
});

slide3.addText([
  { text: "GCN图卷积网络", options: { bullet: true, breakLine: true } },
  { text: "胶囊网络CapsNet", options: { bullet: true, breakLine: true } },
  { text: "多情景数据集构建", options: { bullet: true, breakLine: true } },
  { text: "韧性快速预测评估", options: { bullet: true } }
], {
  x: method3X + 0.15, y: 3.35, w: methodBoxWidth - 0.3, h: 1.8,
  fontSize: 11, fontFace: "Arial",
  color: colors.text
});

// ============================================
// Slide 4: 实验结果
// ============================================
let slide4 = pres.addSlide();
slide4.background = { color: colors.white };

// Header bar
slide4.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 10, h: 1.1,
  fill: { color: colors.primary }
});

// Title
slide4.addText("实验结果", {
  x: 0.5, y: 0.25, w: 9, h: 0.6,
  fontSize: 32, fontFace: "Arial", bold: true,
  color: colors.white, margin: 0
});

// Result 1: Simulation results
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 0.4, y: 1.35, w: 4.4, h: 2,
  fill: { color: colors.light },
  rectRadius: 0.08
});

slide4.addText("耦合仿真验证", {
  x: 0.6, y: 1.5, w: 4, h: 0.4,
  fontSize: 16, fontFace: "Arial", bold: true,
  color: colors.primary, margin: 0
});

slide4.addText([
  { text: "实验区域：天津市滨海新区泰达街区", options: { breakLine: true } },
  { text: "降雨重现期：20年，历时120min", options: { breakLine: true } },
  { text: "成功获取路网交通量时序变化数据", options: {} }
], {
  x: 0.6, y: 2, w: 4, h: 1.2,
  fontSize: 12, fontFace: "Arial",
  color: colors.text
});

// Result 2: Resilience evaluation
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 5.2, y: 1.35, w: 4.4, h: 2,
  fill: { color: colors.light },
  rectRadius: 0.08
});

slide4.addText("韧性评估结果", {
  x: 5.4, y: 1.5, w: 4, h: 0.4,
  fontSize: 16, fontFace: "Arial", bold: true,
  color: colors.primary, margin: 0
});

slide4.addText([
  { text: "改进介数中心性动态反映路段重要性", options: { breakLine: true } },
  { text: "雨型对错位程度排序影响较大", options: { breakLine: true } },
  { text: "成功识别关键路段并制定应急预案", options: {} }
], {
  x: 5.4, y: 2, w: 4, h: 1.2,
  fontSize: 12, fontFace: "Arial",
  color: colors.text
});

// Result 3: Deep learning prediction - highlight
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 0.4, y: 3.55, w: 9.2, h: 1.7,
  fill: { color: colors.primary },
  rectRadius: 0.08
});

slide4.addText("深度学习预测效果", {
  x: 0.6, y: 3.7, w: 4, h: 0.4,
  fontSize: 16, fontFace: "Arial", bold: true,
  color: colors.accent, margin: 0
});

// Stats in boxes
const statBoxWidth = 2.8;
const statY = 4.15;

// Stat 1
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 0.7, y: statY, w: statBoxWidth, h: 0.9,
  fill: { color: colors.secondary },
  rectRadius: 0.05
});

slide4.addText("95%+", {
  x: 0.7, y: statY + 0.05, w: statBoxWidth, h: 0.5,
  fontSize: 24, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide4.addText("预测相似度", {
  x: 0.7, y: statY + 0.5, w: statBoxWidth, h: 0.35,
  fontSize: 11, fontFace: "Arial",
  color: colors.white, align: "center"
});

// Stat 2
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 3.6, y: statY, w: statBoxWidth, h: 0.9,
  fill: { color: colors.secondary },
  rectRadius: 0.05
});

slide4.addText("GCN-CapsNet", {
  x: 3.6, y: statY + 0.05, w: statBoxWidth, h: 0.5,
  fontSize: 20, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide4.addText("优于传统GCN", {
  x: 3.6, y: statY + 0.5, w: statBoxWidth, h: 0.35,
  fontSize: 11, fontFace: "Arial",
  color: colors.white, align: "center"
});

// Stat 3
slide4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 6.5, y: statY, w: statBoxWidth, h: 0.9,
  fill: { color: colors.secondary },
  rectRadius: 0.05
});

slide4.addText("极端暴雨", {
  x: 6.5, y: statY + 0.05, w: statBoxWidth, h: 0.5,
  fontSize: 20, fontFace: "Arial", bold: true,
  color: colors.white, align: "center"
});

slide4.addText("同样有效预测", {
  x: 6.5, y: statY + 0.5, w: statBoxWidth, h: 0.35,
  fontSize: 11, fontFace: "Arial",
  color: colors.white, align: "center"
});

// ============================================
// Slide 5: 结论
// ============================================
let slide5 = pres.addSlide();
slide5.background = { color: colors.dark };

// Decorative circles
slide5.addShape(pres.shapes.OVAL, {
  x: 7.5, y: -1, w: 4, h: 4,
  fill: { color: colors.secondary, transparency: 75 }
});

slide5.addShape(pres.shapes.OVAL, {
  x: -1.5, y: 3.5, w: 3.5, h: 3.5,
  fill: { color: colors.accent, transparency: 70 }
});

// Title
slide5.addText("结论", {
  x: 0.5, y: 0.4, w: 9, h: 0.8,
  fontSize: 36, fontFace: "Arial", bold: true,
  color: colors.white, margin: 0
});

// Three innovation points
const conclusionItems = [
  { num: "01", title: "道路交通推演方法", desc: "耦合内涝与交通协同仿真，推演不同强度暴雨内涝下道路交通变化过程" },
  { num: "02", title: "动态韧性评估方法", desc: "基于改进介数中心性评估路网错位程度，构建GCN-CapsNet模型快速预测" },
  { num: "03", title: "预演评估系统开发", desc: "实现内涝模拟、交通仿真、韧性评估等功能，提供城市交通应急预案" }
];

conclusionItems.forEach((item, idx) => {
  const itemY = 1.4 + idx * 1.25;
  
  // Number box
  slide5.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: itemY, w: 0.8, h: 0.8,
    fill: { color: colors.accent },
    rectRadius: 0.08
  });
  
  slide5.addText(item.num, {
    x: 0.5, y: itemY + 0.15, w: 0.8, h: 0.5,
    fontSize: 22, fontFace: "Arial", bold: true,
    color: colors.dark, align: "center"
  });
  
  // Title
  slide5.addText(item.title, {
    x: 1.5, y: itemY, w: 7.5, h: 0.45,
    fontSize: 18, fontFace: "Arial", bold: true,
    color: colors.white, margin: 0
  });
  
  // Description
  slide5.addText(item.desc, {
    x: 1.5, y: itemY + 0.45, w: 7.5, h: 0.6,
    fontSize: 13, fontFace: "Arial",
    color: colors.gray, margin: 0
  });
});

// Bottom text
slide5.addText("研究成果对于推演城市内涝交通事件、制定灾前交通应急预案、减少交通中断经济损失具有重要参考价值", {
  x: 0.5, y: 4.9, w: 9, h: 0.5,
  fontSize: 12, fontFace: "Arial", italic: true,
  color: colors.accent, align: "center"
});

// Save
pres.writeFile({ fileName: "output.pptx" })
  .then(() => console.log("PPT created: output.pptx"))
  .catch(err => console.error("Error:", err));