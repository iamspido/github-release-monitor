
'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations, useLocale } from 'next-intl';
import { KeyRound, Loader2, LogIn } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { login } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

function LoginButton() {
    const { pending } = useFormStatus();
    const t = useTranslations('LoginPage');

    return (
        <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
            <LogIn className="mr-2 h-4 w-4" />
        )}
        {t('login_button')}
        </Button>
    );
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, undefined);
  const t = useTranslations('LoginPage');
  const searchParams = useSearchParams();
  const next = searchParams.get('next');

  const formRef = React.useRef<HTMLFormElement>(null);
  const [username, setUsername] = React.useState('');

  React.useEffect(() => {
    if (state?.errorKey) {
      // Clear password field on error
      if (formRef.current) {
        const passwordInput = formRef.current.elements.namedItem('password') as HTMLInputElement;
        if (passwordInput) {
          passwordInput.value = '';
        }
      }
    }
  }, [state]);


  return (
    <form ref={formRef} action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>{t('form_title')}</CardTitle>
          <CardDescription>{t('form_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div className="space-y-2">
            <Label htmlFor="username">{t('username_label')}</Label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder={t('username_placeholder')}
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password_label')}</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {state?.errorKey && (
            <Alert variant="destructive">
                <KeyRound className="h-4 w-4" />
                <AlertDescription>{t(state.errorKey as any)}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <LoginButton />
        </CardFooter>
      </Card>
    </form>
  );
}
