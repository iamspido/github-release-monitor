'use client';

import * as React from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  Github,
  Eye,
  EyeOff,
  Beaker,
  Zap,
  PackagePlus,
  RefreshCw,
  Bell,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { RateLimitResult, NotificationConfig, AppriseStatus } from '@/types';
import { sendTestEmailAction, setupTestRepositoryAction, triggerReleaseCheckAction, sendTestAppriseAction, checkAppriseStatusAction } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TestPageClientProps {
  rateLimitResult: RateLimitResult;
  isTokenSet: boolean;
  notificationConfig: NotificationConfig;
  appriseStatus: AppriseStatus;
}

function StatusIndicator({
  status,
  text,
}: {
  status: 'success' | 'warning' | 'error';
  text: string;
}) {
  const icons = {
    success: CheckCircle2,
    warning: AlertTriangle,
    error: XCircle,
  };
  const colors = {
    success: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-destructive',
  };

  const Icon = icons[status];
  const color = colors[status];

  return (
    <div className="flex items-center gap-2">
      <Icon className={`size-5 shrink-0 ${color}`} />
      <span className="font-medium">{text}</span>
    </div>
  );
}

export function TestPageClient({
  rateLimitResult,
  isTokenSet,
  notificationConfig,
  appriseStatus: initialAppriseStatus,
}: TestPageClientProps) {
  const t = useTranslations('TestPage');
  const [isSendingMail, startMailTransition] = React.useTransition();
  const [isSettingUpRepo, startSetupRepoTransition] = React.useTransition();
  const [isTriggeringCheck, startTriggerCheckTransition] = React.useTransition();
  const [isSendingApprise, startAppriseTransition] = React.useTransition();
  const [isCheckingApprise, startAppriseCheckTransition] = React.useTransition();

  const { toast } = useToast();
  const [resetTime, setResetTime] = React.useState(t('not_available'));
  const [isPasswordVisible, setIsPasswordVisible] = React.useState(false);
  const [customEmail, setCustomEmail] = React.useState('');
  const [isEmailInvalid, setIsEmailInvalid] = React.useState(false);
  const [appriseStatus, setAppriseStatus] = React.useState(initialAppriseStatus);

  const rateLimitData = rateLimitResult.data;
  const rateLimitError = rateLimitResult.error;
  const rateLimit = rateLimitData?.rate;

  const isRateLimitHigh = rateLimit ? rateLimit.limit > 1000 : false;
  const requiredMailVars = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_FROM_ADDRESS', 'MAIL_TO_ADDRESS'];

  React.useEffect(() => {
    if (rateLimit) {
      // Format the time on the client to avoid hydration mismatch
      const clientFormattedTime = format(new Date(rateLimit.reset * 1000), 'HH:mm:ss');
      setResetTime(clientFormattedTime);
    }
  }, [rateLimit]);


  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const email = e.target.value;
    setCustomEmail(email);
    if (email.trim().length > 0) {
      // Basic regex for email format validation
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      setIsEmailInvalid(!isValid);
    } else {
      setIsEmailInvalid(false); // Clear error if the field is empty
    }
  };

  const handleSendTestEmail = () => {
    if (isEmailInvalid) return;

    startMailTransition(async () => {
      const result = await sendTestEmailAction(customEmail);
      if (result.success) {
        toast({
          title: t('toast_email_success_title'),
          description: t('toast_email_success_description'),
        });
      } else {
        toast({
          title: t('toast_email_error_title'),
          description: result.error || t('toast_email_error_description'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleSendTestApprise = () => {
    startAppriseTransition(async () => {
        const result = await sendTestAppriseAction();
        if (result.success) {
            toast({
                title: t('toast_apprise_success_title'),
                description: t('toast_apprise_success_description'),
            });
        } else {
            toast({
                title: t('toast_apprise_error_title'),
                description: result.error,
                variant: 'destructive',
            });
        }
    });
  };

  const handleSetupTestRepo = () => {
    startSetupRepoTransition(async () => {
      const result = await setupTestRepositoryAction();
      toast({
        title: result.success ? t('toast_success_title') : t('toast_error_title'),
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    });
  };

  const handleTriggerReleaseCheck = () => {
    startTriggerCheckTransition(async () => {
      const result = await triggerReleaseCheckAction();
      toast({
        title: result.success ? t('toast_success_title') : t('toast_error_title'),
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    });
  };

  const handleRefreshAppriseStatus = () => {
    startAppriseCheckTransition(async () => {
      const status = await checkAppriseStatusAction();
      setAppriseStatus(status);
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Github className="size-8 text-muted-foreground" />
            <div>
                <CardTitle>{t('github_card_title')}</CardTitle>
                <CardDescription>
                {t('github_card_description')}
                </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusIndicator
            status={isTokenSet ? 'success' : 'warning'}
            text={
              isTokenSet
                ? t('token_set')
                : t('token_not_set')
            }
          />
          {!isTokenSet && (
            <p className="text-sm text-muted-foreground pl-7">
                {t('token_advice')}
            </p>
          )}

          {rateLimitData ? (
            <div>
                <StatusIndicator
                    status={isRateLimitHigh ? 'success' : 'warning'}
                    text={
                        isRateLimitHigh
                        ? t('auth_access_confirmed')
                        : t('unauth_access')
                    }
                />
                <div className="mt-2 pl-7 text-sm text-muted-foreground space-y-1">
                    <p>{t('api_limit', { limit: rateLimit?.limit })}</p>
                    <p>{t('api_remaining', { remaining: rateLimit?.remaining })}</p>
                    <p>{t('api_resets', { time: resetTime })}</p>
                </div>
            </div>
          ) : (
            <StatusIndicator
                status='error'
                text={t(rateLimitError === 'invalid_token' ? 'invalid_token_error' : 'rate_limit_fail')}
              />
          )}
          {isTokenSet && rateLimitError === 'invalid_token' && (
              <p className="text-sm text-muted-foreground pl-7">
                  {t('invalid_token_advice')}
              </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Bell className="size-8 text-muted-foreground" />
            <div>
              <CardTitle>{t('apprise_card_title')}</CardTitle>
              <CardDescription>{t('apprise_card_description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {appriseStatus.status === 'not_configured' ? (
            <StatusIndicator status="warning" text={t('apprise_not_configured')} />
          ) : appriseStatus.status === 'ok' ? (
            <StatusIndicator status="success" text={t('apprise_ok')} />
          ) : (
            <div>
              <StatusIndicator status="error" text={t('apprise_error')} />
              <p className="pl-7 text-sm text-muted-foreground">{appriseStatus.error}</p>
            </div>
          )}

          <p className="text-sm text-muted-foreground font-mono break-all pl-7">
              <span className="font-semibold text-foreground">APPRISE_URL=</span>
              {notificationConfig.variables.APPRISE_URL ? (
                <span>{notificationConfig.variables.APPRISE_URL}</span>
              ) : (
                <span className="italic">{t('email_not_set')}</span>
              )}
          </p>
          <div className="flex flex-col items-start gap-4 pt-2">
            <Button
              onClick={handleRefreshAppriseStatus}
              disabled={isCheckingApprise || appriseStatus.status === 'not_configured'}
              variant="outline"
              size="sm"
            >
              {isCheckingApprise ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              <span>{t('apprise_refresh_status_button')}</span>
            </Button>
            <Button
              onClick={handleSendTestApprise}
              disabled={isSendingApprise || appriseStatus.status !== 'ok'}
              size="sm"
            >
              {isSendingApprise ? <Loader2 className="animate-spin" /> : <Bell />}
              <span>{t('send_test_apprise_button')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <div className="flex items-center gap-3">
                <Mail className="size-8 text-muted-foreground" />
                <div>
                    <CardTitle>{t('email_card_title')}</CardTitle>
                    <CardDescription>
                    {t('email_card_description')}
                    </CardDescription>
                </div>
            </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <StatusIndicator
                status={notificationConfig.isSmtpConfigured ? 'success' : 'warning'}
                text={
                notificationConfig.isSmtpConfigured
                    ? t('email_configured')
                    : t('email_not_configured')
                }
            />

            <div className="pl-7 pt-4 border-t space-y-3">
              <h4 className="font-semibold text-sm">{t('email_all_variables_title')}</h4>

              {notificationConfig.variables['MAIL_PASSWORD'] && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                      <AlertTriangle className="size-5 shrink-0" />
                      <p>{t('email_password_warning')}</p>
                  </div>
              )}
              <div className="text-sm text-muted-foreground font-mono space-y-2 break-all">
                  {Object.entries(notificationConfig.variables).map(([key, value]) => {
                    if (key === 'APPRISE_URL') return null; // Handled in its own card
                    const isRequired = requiredMailVars.includes(key);
                    const isMissingAndRequired = isRequired && !value;

                    if (key === 'MAIL_PASSWORD' && value) {
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <p className="flex-grow">
                            <span className="font-semibold text-foreground">{key}=</span>
                            <span>{isPasswordVisible ? value : '••••••••'}</span>
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                            aria-label={t(isPasswordVisible ? 'hide_password' : 'show_password')}
                          >
                            {isPasswordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </div>
                      );
                    }

                    return (
                        <p key={key}>
                            <span className="font-semibold text-foreground">{key}=</span>
                            {value ? <span>{value}</span> : <span className={`italic ${isMissingAndRequired ? 'text-yellow-500' : ''}`}>{t('email_not_set')}</span>}
                        </p>
                    );
                  })}
              </div>
            </div>

            <div className="pt-4 space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="test-email-recipient">{t('email_recipient_label')}</Label>
                    <Input
                        id="test-email-recipient"
                        type="email"
                        placeholder={t('email_recipient_placeholder')}
                        value={customEmail}
                        onChange={handleEmailChange}
                        disabled={isSendingMail || !notificationConfig.isSmtpConfigured}
                        className={cn(isEmailInvalid && 'border-destructive focus-visible:ring-destructive')}
                    />
                    {isEmailInvalid && <p className="text-sm text-destructive">{t('invalid_email_format')}</p>}
                </div>
                <div>
                    <Button onClick={handleSendTestEmail} disabled={isSendingMail || !notificationConfig.isSmtpConfigured || isEmailInvalid}>
                        {isSendingMail ? (
                            <Loader2 className="mr-2 animate-spin" />
                        ) : (
                            <Mail className="mr-2" />
                        )}
                        {t('send_test_email_button')}
                    </Button>
                    {!notificationConfig.isSmtpConfigured && (
                        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <AlertTriangle className="size-4 shrink-0" />
                            <span>{t('email_config_required_tooltip')}</span>
                        </p>
                    )}
                </div>
            </div>
        </CardContent>
      </Card>

      <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
                <Beaker className="size-8 text-muted-foreground" />
                <div>
                    <CardTitle>{t('notification_card_title')}</CardTitle>
                    <CardDescription>
                        {t('notification_card_description')}
                    </CardDescription>
                </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
              <div className="space-y-3">
                  <h4 className="font-semibold">{t('e2e_step1_title')}</h4>
                  <p className="text-sm text-muted-foreground">{t('e2e_step1_description')}</p>
                    <Button onClick={handleSetupTestRepo} disabled={isSettingUpRepo}>
                        {isSettingUpRepo ? (
                            <Loader2 className="mr-2 animate-spin" />
                        ) : (
                            <PackagePlus className="mr-2" />
                        )}
                        {t('setup_test_repo_button')}
                    </Button>
              </div>
              <div className="space-y-3">
                  <h4 className="font-semibold">{t('e2e_step2_title')}</h4>
                  <p className="text-sm text-muted-foreground">{t('e2e_step2_description')}</p>
                    <div>
                        <Button onClick={handleTriggerReleaseCheck} disabled={isTriggeringCheck || (!notificationConfig.isSmtpConfigured && !notificationConfig.isAppriseConfigured)}>
                            {isTriggeringCheck ? (
                                <Loader2 className="mr-2 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2" />
                            )}
                            {t('trigger_check_button')}
                        </Button>
                        {!notificationConfig.isSmtpConfigured && !notificationConfig.isAppriseConfigured && (
                            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                                <AlertTriangle className="size-4 shrink-0" />
                                <span>{t('notification_config_required_tooltip')}</span>
                            </p>
                        )}
                    </div>
              </div>
          </CardContent>
      </Card>
    </div>
  );
}
