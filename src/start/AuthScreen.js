/* @flow strict-local */

import React, { PureComponent } from 'react';
import type { ComponentType } from 'react';
import { Linking, Platform } from 'react-native';
import type { AppleAuthenticationCredential } from 'expo-apple-authentication';
import * as AppleAuthentication from 'expo-apple-authentication';

import type {
  ServerSettings,
  AuthenticationMethods,
  ExternalAuthenticationMethod,
} from '../api/settings/getServerSettings';
import type { RouteProp } from '../react-navigation';
import type { AppNavigationProp } from '../nav/AppNavigator';
import isAppOwnDomain from '../isAppOwnDomain';
import type { GlobalDispatch } from '../types';
import {
  IconApple,
  IconPrivate,
  IconGoogle,
  IconGitHub,
  IconWindows,
  IconTerminal,
} from '../common/Icons';
import type { SpecificIconType } from '../common/Icons';
import { connectGlobal } from '../react-redux';
import styles from '../styles';
import Centerer from '../common/Centerer';
import Screen from '../common/Screen';
import ZulipButton from '../common/ZulipButton';
import RealmInfo from './RealmInfo';
import { encodeParamsForUrl } from '../utils/url';
import * as webAuth from './webAuth';
import { loginSuccess } from '../actions';
import IosCompliantAppleAuthButton from './IosCompliantAppleAuthButton';
import { openLinkEmbedded } from '../utils/openLink';

/**
 * Describes a method for authenticating to the server.
 *
 * Different servers and orgs/realms accept different sets of auth methods,
 * described in the /server_settings response; see api.getServerSettings
 * and https://zulip.com/api/get-server-settings .
 */
type AuthenticationMethodDetails = {|
  /** An identifier-style name used in the /server_settings API. */
  name: string,

  /** A name to show in the UI. */
  displayName: string,

  Icon: SpecificIconType,
  action: 'dev' | 'password' | {| url: string |},
|};

// Methods that don't show up in external_authentication_methods.
const availableDirectMethods: $ReadOnlyArray<AuthenticationMethodDetails> = [
  {
    name: 'dev',
    displayName: 'dev account',
    Icon: IconTerminal,
    action: 'dev',
  },
  {
    name: 'password',
    displayName: 'password',
    Icon: IconPrivate,
    action: 'password',
  },
  {
    name: 'ldap',
    displayName: 'password',
    Icon: IconPrivate,
    action: 'password',
  },
  {
    // This one might move to external_authentication_methods in the future.
    name: 'remoteuser',
    displayName: 'SSO',
    Icon: IconPrivate,
    action: { url: 'accounts/login/sso/' },
  },
];

const externalMethodIcons = new Map([
  ['google', IconGoogle],
  ['github', IconGitHub],
  ['azuread', IconWindows],
  ['apple', IconApple],
]);

/** Exported for tests only. */
export const activeAuthentications = (
  authenticationMethods: AuthenticationMethods,
  externalAuthenticationMethods: $ReadOnlyArray<ExternalAuthenticationMethod>,
): $ReadOnlyArray<AuthenticationMethodDetails> => {
  const result = [];

  // A server might intend some of these, such as 'dev' or 'password', but
  // omit them in external_authentication_methods. The only sign that
  // they're intended is their presence in authentication_methods… even
  // though that's marked as deprecated in 2.1. Discussion:
  //   https://chat.zulip.org/#narrow/stream/412-api-documentation/topic/audit.20for.20change.20entries.20vs.2E.20central.20changelog/near/1404115
  availableDirectMethods.forEach(auth => {
    if (!authenticationMethods[auth.name]) {
      return;
    }
    if (auth.name === 'ldap' && authenticationMethods.password === true) {
      // For either of these, we show a button that looks and behaves
      // exactly the same.  When both are enabled, dedupe them.
      return;
    }
    result.push(auth);
  });

  externalAuthenticationMethods.forEach(method => {
    if (result.some(({ name }) => name === method.name)) {
      // Ignore duplicate.
      return;
    }

    // The server provides icons as image URLs; but we have our own built
    // in, which we don't have to load and can color to match the button.
    // TODO perhaps switch to server's, for the sake of SAML where ours is
    //   generic and the server may have a more specific one.
    const Icon = externalMethodIcons.get(method.name) ?? IconPrivate;

    result.push({
      name: method.name,
      displayName: method.display_name,
      Icon,
      action: { url: method.login_url },
    });
  });

  return result;
};

type OuterProps = $ReadOnly<{|
  // These should be passed from React Navigation
  navigation: AppNavigationProp<'auth'>,
  route: RouteProp<
    'auth',
    {|
      // Keep constant through the life of an 'auth' route: don't
      // `navigation.navigate` or `navigation.setParams` or do anything else
      // that can change this. We use it to identify the server to the user,
      // and also to identify which server to send auth credentials to. So
      // we mustn't let it jump out from under the user.
      serverSettings: ServerSettings,
    |},
  >,
|}>;

type SelectorProps = $ReadOnly<{||}>;

type Props = $ReadOnly<{|
  ...OuterProps,

  dispatch: GlobalDispatch,
  ...SelectorProps,
|}>;

let otp = '';

/**
 * An event emitted by `Linking`.
 *
 * Determined by reading the implementation source code, and documentation:
 *   https://reactnative.dev/docs/linking
 *
 * TODO move this to a libdef, and/or get an explicit type into upstream.
 */
type LinkingEvent = {
  url: string,
  ...
};

class AuthScreenInner extends PureComponent<Props> {
  componentDidMount() {
    Linking.addEventListener('url', this.endWebAuth);
    Linking.getInitialURL().then((initialUrl: ?string) => {
      if (initialUrl !== null && initialUrl !== undefined) {
        this.endWebAuth({ url: initialUrl });
      }
    });

    const { serverSettings } = this.props.route.params;
    const authList = activeAuthentications(
      serverSettings.authentication_methods,
      serverSettings.external_authentication_methods,
    );
    if (authList.length === 1) {
      this.handleAuth(authList[0]);
    }
  }

  componentWillUnmount() {
    Linking.removeEventListener('url', this.endWebAuth);
  }

  /**
   * Hand control to the browser for an external auth method.
   *
   * @param url The `login_url` string, a relative URL, from an
   * `external_authentication_method` object from `/server_settings`.
   */
  beginWebAuth = async (url: string) => {
    const { serverSettings } = this.props.route.params;
    otp = await webAuth.generateOtp();
    webAuth.openBrowser(new URL(url, serverSettings.realm_uri).toString(), otp);
  };

  endWebAuth = (event: LinkingEvent) => {
    webAuth.closeBrowser();

    const { dispatch } = this.props;
    const { serverSettings } = this.props.route.params;
    const auth = webAuth.authFromCallbackUrl(event.url, otp, serverSettings.realm_uri);
    if (auth) {
      dispatch(loginSuccess(auth.realm, auth.email, auth.apiKey));
    }
  };

  handleDevAuth = () => {
    const { serverSettings } = this.props.route.params;
    this.props.navigation.push('dev-auth', {
      realm: serverSettings.realm_uri,
    });
  };

  handlePassword = () => {
    const { serverSettings } = this.props.route.params;
    const realm = serverSettings.realm_uri;
    this.props.navigation.push('password-auth', {
      realm,
      requireEmailFormat: serverSettings.require_email_format_usernames,
    });
  };

  handleNativeAppleAuth = async () => {
    const { serverSettings } = this.props.route.params;

    const state = await webAuth.generateRandomToken();
    const credential: AppleAuthenticationCredential = await AppleAuthentication.signInAsync({
      state,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (credential.state !== state) {
      throw new Error('`state` mismatch');
    }

    otp = await webAuth.generateOtp();

    const params = encodeParamsForUrl({
      mobile_flow_otp: otp,
      native_flow: true,
      id_token: credential.identityToken,
    });

    openLinkEmbedded(new URL(`/complete/apple/?${params}`, serverSettings.realm_uri));

    // Currently, the rest is handled with the `zulip://` redirect,
    // same as in the web flow.
    //
    // TODO: Maybe have an endpoint we can just send a request to,
    // with `fetch`, and get the API key right away, without ever
    // having to open the browser.
  };

  canUseNativeAppleFlow = async () => {
    const { serverSettings } = this.props.route.params;

    if (!(Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync()))) {
      return false;
    }

    // The native flow for Apple auth assumes that the app and the server
    // are operated by the same organization, so that for a user to
    // entrust private information to either one is the same as entrusting
    // it to the other.  Check that this realm is on such a server.
    //
    // (For other realms, we'll simply fall back to the web flow, which
    // handles things appropriately without relying on that assumption.)
    return isAppOwnDomain(serverSettings.realm_uri);
  };

  handleAuth = async (method: AuthenticationMethodDetails) => {
    const { action } = method;

    if (action === 'dev') {
      this.handleDevAuth();
    } else if (action === 'password') {
      this.handlePassword();
    } else if (method.name === 'apple' && (await this.canUseNativeAppleFlow())) {
      this.handleNativeAppleAuth();
    } else {
      this.beginWebAuth(action.url);
    }
  };

  render() {
    const { serverSettings } = this.props.route.params;

    return (
      <Screen title="Log in" centerContent padding shouldShowLoadingBanner={false}>
        <Centerer>
          <RealmInfo
            name={serverSettings.realm_name}
            iconUrl={new URL(serverSettings.realm_icon, serverSettings.realm_uri).toString()}
          />
          {activeAuthentications(
            serverSettings.authentication_methods,
            serverSettings.external_authentication_methods,
          ).map(auth =>
            auth.name === 'apple' && Platform.OS === 'ios' ? (
              <IosCompliantAppleAuthButton
                key={auth.name}
                style={styles.halfMarginTop}
                onPress={() => this.handleAuth(auth)}
              />
            ) : (
              <ZulipButton
                key={auth.name}
                style={styles.halfMarginTop}
                secondary
                text={{
                  text: 'Sign in with {method}',
                  values: { method: auth.displayName },
                }}
                Icon={auth.Icon}
                onPress={() => this.handleAuth(auth)}
              />
            ),
          )}
          <ZulipButton
            style={styles.halfMarginTop}
            text="Don't have an account? Sign up"
            Icon={IconPrivate}
            onPress={() => {
              const registrationUrl = new URL('/register/', serverSettings.realm_uri).toString();
              Linking.openURL(registrationUrl);
            }}
          />
        </Centerer>
      </Screen>
    );
  }
}

const AuthScreen: ComponentType<OuterProps> = connectGlobal<{||}, _, _>()(AuthScreenInner);

export default AuthScreen;
