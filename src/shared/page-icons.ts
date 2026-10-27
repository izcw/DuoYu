import Home from '@icon-park/vue-next/es/icons/Home';
import Bookmark from '@icon-park/vue-next/es/icons/Bookmark';
import Star from '@icon-park/vue-next/es/icons/Star';
import Heart from '@icon-park/vue-next/es/icons/Like';
import Folder from '@icon-park/vue-next/es/icons/Folder';
import Briefcase from '@icon-park/vue-next/es/icons/Briefcase';
import Computer from '@icon-park/vue-next/es/icons/Computer';
import Code from '@icon-park/vue-next/es/icons/Terminal';
import Music from '@icon-park/vue-next/es/icons/FileMusic';
import VideoCamera from '@icon-park/vue-next/es/icons/VideoOne';
import Picture from '@icon-park/vue-next/es/icons/PictureAlbum';
import Book from '@icon-park/vue-next/es/icons/Book';
import Calendar from '@icon-park/vue-next/es/icons/Calendar';
import Notes from '@icon-park/vue-next/es/icons/Notes';
import ShoppingBag from '@icon-park/vue-next/es/icons/ShoppingBag';
import GameHandle from '@icon-park/vue-next/es/icons/GameHandle';
import Globe from '@icon-park/vue-next/es/icons/Globe';
import Mail from '@icon-park/vue-next/es/icons/Mail';
import Message from '@icon-park/vue-next/es/icons/Message';
import Search from '@icon-park/vue-next/es/icons/Search';
import Setting from '@icon-park/vue-next/es/icons/Setting';
import User from '@icon-park/vue-next/es/icons/People';
import Peoples from '@icon-park/vue-next/es/icons/Peoples';
import ChartHistogram from '@icon-park/vue-next/es/icons/ChartPie';
import Finance from '@icon-park/vue-next/es/icons/Finance';
import Wallet from '@icon-park/vue-next/es/icons/Wallet';
import School from '@icon-park/vue-next/es/icons/School';
import Airplane from '@icon-park/vue-next/es/icons/Airplane';
import Car from '@icon-park/vue-next/es/icons/Car';
import Cup from '@icon-park/vue-next/es/icons/CupOne';
import Sun from '@icon-park/vue-next/es/icons/SunOne';
import Moon from '@icon-park/vue-next/es/icons/Moon';
import Add from '@icon-park/vue-next/es/icons/Add';
export const pageIcons = [
  { id: 'Home', label: '首页', component: Home },
  { id: 'Bookmark', label: '收藏', component: Bookmark },
  { id: 'Star', label: '星标', component: Star },
  { id: 'Heart', label: '喜爱', component: Heart },
  { id: 'Folder', label: '文件夹', component: Folder },
  { id: 'Briefcase', label: '工作', component: Briefcase },
  { id: 'Computer', label: '电脑', component: Computer },
  { id: 'Code', label: '编程', component: Code },
  { id: 'Music', label: '音乐', component: Music },
  { id: 'VideoCamera', label: '视频', component: VideoCamera },
  { id: 'Picture', label: '图片', component: Picture },
  { id: 'Book', label: '阅读', component: Book },
  { id: 'Calendar', label: '日历', component: Calendar },
  { id: 'Notes', label: '笔记', component: Notes },
  { id: 'ShoppingBag', label: '购物', component: ShoppingBag },
  { id: 'GameHandle', label: '游戏', component: GameHandle },
  { id: 'Globe', label: '世界', component: Globe },
  { id: 'Mail', label: '邮件', component: Mail },
  { id: 'Message', label: '消息', component: Message },
  { id: 'Search', label: '搜索', component: Search },
  { id: 'Setting', label: '设置', component: Setting },
  { id: 'User', label: '个人', component: User },
  { id: 'Peoples', label: '团队', component: Peoples },
  { id: 'ChartHistogram', label: '图表', component: ChartHistogram },
  { id: 'Finance', label: '财经', component: Finance },
  { id: 'Wallet', label: '钱包', component: Wallet },
  { id: 'School', label: '学习', component: School },
  { id: 'Airplane', label: '旅行', component: Airplane },
  { id: 'Car', label: '汽车', component: Car },
  { id: 'Cup', label: '生活', component: Cup },
  { id: 'Sun', label: '阳光', component: Sun },
  { id: 'Moon', label: '月亮', component: Moon },
];
export function pageIcon(id?: string) {
  return id === 'Add'
    ? Add
    : pageIcons.find((icon) => icon.id === id)?.component || Bookmark;
}
