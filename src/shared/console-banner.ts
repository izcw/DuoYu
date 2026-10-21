import { browser } from 'wxt/browser';

export function printConsoleBanner() {
  const version = browser.runtime.getManifest().version;
  const year = new Date().getFullYear();
  const brand = 'color: #70c000; font-size: 12px; line-height: 1.6;';
  const text = brand;
  const logo = [
    ' ____                  __   __',
    '|  _ \\ _   _  ___      \\ \\ / /   _',
    '| | | | | | |/ _ \\      \\ V / | | |',
    '| |_| | |_| | (_) |      | || |_| |',
    '|____/ \\__,_|\\___/       |_| \\__,_|',
  ].join('\n');

  console.log(
    `%cDuoYu 多鱼起始页%c  Version ${version}\n%c欢迎来到多鱼起始页！\n\n%c${logo}\n\n%c作者：izcw\n官网：https://duoyu.link/\n© ${year} izcw. All Rights Reserved.`,
    brand,
    text,
    brand,
    `${brand}font-family: monospace; white-space: pre; font-size: 10px; line-height: 1.2;`,
    text,
  );
}
