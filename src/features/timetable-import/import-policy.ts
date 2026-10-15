import { isPhonePreview } from '../../browserEnvironment';
import { isAndroid } from '../../platform';

declare const __LUDIAN_TABLE_IMPORT_ONLY__: boolean;

const androidBuild =
  typeof __LUDIAN_TABLE_IMPORT_ONLY__ !== 'undefined' && __LUDIAN_TABLE_IMPORT_ONLY__;

export const tableImportOnly = androidBuild || isAndroid || isPhonePreview;
export const courseImportAccept = tableImportOnly
  ? '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
  : 'image/*,.xlsx,.csv,.pdf';
export const courseImportLabel = tableImportOnly ? '选择课表文件' : '选择课程表图片或文件';
export const courseImportHint = tableImportOnly
  ? '支持 Excel / CSV，选择后自动追加。已有课程保留。'
  : '支持图片、Excel / CSV 和 PDF，选择后自动追加。已有课程保留。';
