import {createNavigation} from 'next-intl/navigation';
import {locales, pathnames} from './i18n-config';

export const {Link, redirect, usePathname, useRouter, getPathname} =
  createNavigation({locales, pathnames, localePrefix: 'always'});
