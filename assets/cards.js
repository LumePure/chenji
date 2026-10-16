/* 宸玑 v5 圆柱卡片配置。
   以后换真图：把 images 里对应位置改成图片路径（相对 index.html，建议放 assets/products/，横图 4:3 最佳，会居中裁切），
   例如 images: ['assets/products/ht-01.jpg', null, 'assets/products/spg-001.jpg']。
   留 null / 空字符串 / 超出数组长度的卡片，一律画留白占位「产品图 NN」。图片须同源（或带 CORS），否则 WebGL 无法使用。 */
window.CJ_CARDS = {
  count: 60,          // 产品图编号数（产品图 01–60）；画面上的卡片数随屏幕高度取 60–80 张，超出部分按编号循环
  perRing: 10,        // 每圈卡片数
  images: []          // 产品图列表，按卡片编号顺序（0 起）
};
