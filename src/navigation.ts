import {createSharedPathnamesNavigation} from 'next-intl/navigation';
import {locales, pathnames} from './i18n';

export const {Link, redirect, usePathname, useRouter} =
  createSharedPathnamesNavigation({locales, localePrefix: 'always'});
