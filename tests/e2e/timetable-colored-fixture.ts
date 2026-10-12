import type { Page } from '@playwright/test';

export const fictionalCatalog = [
  '数字设计',
  '创意写作',
  '图像设计A3',
  '色彩构成',
  '程序入门',
  '摄影实践',
  '动画制作',
  '空间建模',
  '声音设计',
  '视觉实训',
  '艺术理论',
  '体育训练3',
  '数据入门',
].map((name, index) => ({
  name,
  teacher: '测试老师',
  code: `V${String(1001 + index).padStart(7, '0')}`,
}));

export const fictionalCards = [
  { name: '空间建模', day: '1', start: '3', end: '4', room: '测试楼-201' },
  { name: '动画制作', day: '1', start: '5', end: '8', room: '测试楼-201' },
  { name: '艺术理论', day: '2', start: '1', end: '2', room: '测试楼-202' },
  { name: '图像设计A3', day: '2', start: '3', end: '4', room: '测试楼-203' },
  { name: '数据入门', day: '2', start: '5', end: '6', room: '测试楼-204' },
  { name: '色彩构成', day: '3', start: '1', end: '2', room: '测试楼-201' },
  { name: '程序入门', day: '3', start: '3', end: '4', room: '测试楼-201' },
  { name: '空间建模', day: '4', start: '3', end: '4', room: '测试楼-201' },
  { name: '摄影实践', day: '4', start: '5', end: '6', room: '测试楼-205' },
  { name: '程序入门', day: '4', start: '7', end: '8', room: '测试楼-201' },
  { name: '体育训练3', day: '5', start: '3', end: '4', room: '测试球场' },
];

export async function coloredTimetableFixtures(page: Page) {
  return page.evaluate(
    ({ catalog, cards }) => {
      const table = document.createElement('canvas');
      const columns = [0, 320, 565, 1015, 1245, 1395, 1600];
      const rowHeight = 72;
      table.width = 1600;
      table.height = rowHeight * (catalog.length + 1) + 20;
      const tableContext = table.getContext('2d')!;
      tableContext.fillStyle = '#fafdfe';
      tableContext.fillRect(0, 0, table.width, table.height);
      tableContext.strokeStyle = '#a9c9d0';
      tableContext.lineWidth = 2;
      for (const x of columns) {
        tableContext.beginPath();
        tableContext.moveTo(x, 0);
        tableContext.lineTo(x, rowHeight * (catalog.length + 1));
        tableContext.stroke();
      }
      for (let row = 0; row <= catalog.length + 1; row++) {
        tableContext.beginPath();
        tableContext.moveTo(0, row * rowHeight);
        tableContext.lineTo(table.width, row * rowHeight);
        tableContext.stroke();
      }
      tableContext.fillStyle = '#151515';
      tableContext.font = '36px "Microsoft YaHei", sans-serif';
      tableContext.textAlign = 'center';
      tableContext.textBaseline = 'middle';
      const rows = [
        ['开课单位', '课程代码', '课程名称', '任课教师', '课程性质', '课程大类'],
        ...catalog.map((entry) => [
          '测试学院',
          entry.code,
          entry.name,
          entry.teacher,
          '必修',
          '普通课',
        ]),
      ];
      rows.forEach((row, rowIndex) =>
        row.forEach((text, column) =>
          tableContext.fillText(
            text,
            (columns[column] + columns[column + 1]) / 2,
            (rowIndex + 0.5) * rowHeight,
          ),
        ),
      );

      const grid = document.createElement('canvas');
      grid.width = 1280;
      grid.height = 2350;
      const context = grid.getContext('2d')!;
      context.fillStyle = '#dde3f5';
      context.fillRect(0, 0, grid.width, grid.height);
      context.fillStyle = '#151515';
      context.font = '48px "Microsoft YaHei", sans-serif';
      context.fillText('第5周 周五', 36, 60);
      context.font = '34px "Microsoft YaHei", sans-serif';
      context.fillText('2030/10/9', 36, 116);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      [...'一二三四五六日'].forEach((day, index) => {
        context.font = '48px "Microsoft YaHei", sans-serif';
        context.fillText(day, 190 + index * 166, 185);
        context.font = '32px "Microsoft YaHei", sans-serif';
        context.fillText(String(index + 5), 190 + index * 166, 255);
      });
      for (let period = 1; period <= 10; period++) {
        context.font = '52px "Microsoft YaHei", sans-serif';
        context.fillText(String(period), 45, 360 + (period - 1) * 205);
        context.font = '24px "Microsoft YaHei", sans-serif';
        context.fillText(`${String(7 + period).padStart(2, '0')}:00`, 45, 405 + (period - 1) * 205);
      }
      const colors = ['#398fe2', '#377bc1', '#e8547c', '#a47bee', '#ed901d', '#ef5677'];
      const wrap = (text: string) => {
        const lines: string[] = [];
        let line = '';
        for (const character of text.match(/[A-Za-z]+\d*|\d+|./gu) ?? []) {
          if (line && context.measureText(line + character).width > 132) {
            lines.push(line);
            line = character;
          } else line += character;
        }
        if (line) lines.push(line);
        return lines;
      };
      cards.forEach((card, index) => {
        const x = 114 + (Number(card.day) - 1) * 166;
        const y = 300 + (Number(card.start) - 1) * 205;
        const width = 152;
        const height = (Number(card.end) - Number(card.start) + 1) * 205 - 14;
        context.fillStyle = colors[index % colors.length];
        context.beginPath();
        context.roundRect(x, y, width, height, 14);
        context.fill();
        context.strokeStyle = '#fbfbfb';
        context.lineWidth = 3;
        context.stroke();
        context.font = '48px "Microsoft YaHei", sans-serif';
        context.fillStyle = '#fff';
        const name = wrap(card.name);
        context.font = '42px "Microsoft YaHei", sans-serif';
        const room = wrap(`@${card.room}`);
        const totalHeight = (name.length + room.length) * 57 + 20;
        let baseline = y + (height - totalHeight) / 2 + 28;
        context.font = '48px "Microsoft YaHei", sans-serif';
        for (const line of name) {
          context.fillText(line, x + width / 2, baseline);
          baseline += 57;
        }
        baseline += 20;
        context.font = '42px "Microsoft YaHei", sans-serif';
        for (const line of room) {
          context.fillText(line, x + width / 2, baseline);
          baseline += 57;
        }
      });
      context.fillStyle = '#353535';
      context.beginPath();
      context.roundRect(1175, 900, 105, 300, 28);
      context.fill();
      context.fillStyle = '#fff';
      context.font = '38px "Microsoft YaHei", sans-serif';
      [...'结束本周'].forEach((text, index) => context.fillText(text, 1225, 940 + index * 65));

      const scaled = document.createElement('canvas');
      scaled.width = Math.round(grid.width * 0.75);
      scaled.height = Math.round(grid.height * 0.75);
      scaled.getContext('2d')!.drawImage(grid, 0, 0, scaled.width, scaled.height);
      return {
        catalog: table.toDataURL('image/png').split(',')[1],
        timetable: grid.toDataURL('image/png').split(',')[1],
        scaledTimetable: scaled.toDataURL('image/jpeg', 0.85).split(',')[1],
      };
    },
    { catalog: fictionalCatalog, cards: fictionalCards },
  );
}
