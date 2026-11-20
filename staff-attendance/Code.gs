function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('職員の勤怠・食事記録')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
