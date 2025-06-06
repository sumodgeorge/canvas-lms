/*
 * Copyright (C) 2016 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import {useScope as createI18nScope} from '@canvas/i18n'
import tourPubSub from '@canvas/tour-pubsub'
import {replaceLocation} from '@canvas/util/globalUtils'
import {PresentationContent, ScreenReaderContent} from '@instructure/ui-a11y-content'
import {Flex} from '@instructure/ui-flex'
import {Link} from '@instructure/ui-link'
import {List} from '@instructure/ui-list'
import {Pill} from '@instructure/ui-pill'
import {Spinner} from '@instructure/ui-spinner'
import {Text} from '@instructure/ui-text'
import {View} from '@instructure/ui-view'
import React from 'react'
import type {HelpLink} from '../../../api.d'
import helpLinksQuery from '../queries/helpLinksQuery'
import FeaturedHelpLink from './FeaturedHelpLink'
import {useQuery} from '@tanstack/react-query'
import {sessionStoragePersister} from '@canvas/query'

const I18n = createI18nScope('HelpLinks')

type Props = {
  onClick: (url: string) => void
}

export default function HelpLinks({onClick}: Props) {
  const {data, isLoading, isSuccess} = useQuery<HelpLink[]>({
    queryKey: ['helpLinks'],
    queryFn: helpLinksQuery,
    persister: sessionStoragePersister,
    // 1 hour
    staleTime: 60 * 60 * 1000,
  })

  const links = data || []

  const featuredLink = links.find(link => link.is_featured)
  const nonFeaturedLinks = links.filter(link => !link.is_featured)
  const showSeparator = featuredLink && !!nonFeaturedLinks.length

  const handleClick = (link: HelpLink) => (event: React.MouseEvent<unknown, MouseEvent>) => {
    if (link.url === '#create_ticket' || link.url === '#teacher_feedback') {
      event.preventDefault()
      onClick(link.url)
    }
    if (link.no_new_window) {
      event.preventDefault()
      replaceLocation(link.url)
    }
  }

  if (isSuccess) {
    return (
      <View>
        <FeaturedHelpLink featuredLink={featuredLink} handleClick={handleClick} />
        {showSeparator && (
          <View display="block" margin="medium 0 0">
            <Text weight="bold" transform="uppercase" size="small" lineHeight="double">
              {I18n.t('OTHER RESOURCES')}
            </Text>
            <hr role="presentation" style={{marginTop: '0'}} />
          </View>
        )}
        <List isUnstyled={true} margin="small 0" itemSpacing="small">
          {nonFeaturedLinks
            .map(link => {
              const has_new_tag = link.is_new
              return (
                <List.Item key={`link-${link.id}`}>
                  <Flex justifyItems="space-between" alignItems="center">
                    <Flex.Item size={has_new_tag ? '80%' : '100%'}>
                      <span role="presentation">
                        <Link
                          isWithinText={false}
                          href={link.url}
                          onClick={handleClick(link)}
                          target="_blank"
                          rel="noopener"
                        >
                          {link.text || ''}
                        </Link>
                      </span>
                      {has_new_tag && <ScreenReaderContent>{I18n.t('New')}</ScreenReaderContent>}
                      {link.subtext && (
                        <Text as="div" size="small">
                          {link.subtext}
                        </Text>
                      )}
                    </Flex.Item>
                    <Flex.Item>
                      {has_new_tag && (
                        <PresentationContent>
                          <Pill color="success">{I18n.t('NEW')}</Pill>
                        </PresentationContent>
                      )}
                    </Flex.Item>
                  </Flex>
                </List.Item>
              )
            })
            .concat(
              // if the current user is a teacher, show a link to
              // open up the welcome tour
              window.ENV.FEATURES?.product_tours &&
                (window.ENV.current_user_types?.includes('AccountAdmin') ||
                  window.ENV.current_user_roles?.includes('teacher') ||
                  window.ENV.current_user_roles?.includes('student'))
                ? [
                    <List.Item key="welcome_tour">
                      <View className="welcome-tour-link">
                        <Link isWithinText={false} onClick={() => tourPubSub.publish('tour-open')}>
                          {I18n.t('Show Welcome Tour')}
                        </Link>
                      </View>
                    </List.Item>,
                  ]
                : [],
            )
            .concat(
              // if the current user is an admin, show the settings link to
              // customize this menu
              window.ENV.current_user_roles?.includes('root_admin')
                ? [
                    <List.Item key="hr">
                      <hr role="presentation" />
                    </List.Item>,
                    <List.Item key="customize">
                      <Link
                        isWithinText={false}
                        href="/accounts/self/settings#custom_help_link_settings"
                      >
                        {I18n.t('Customize this menu')}
                      </Link>
                    </List.Item>,
                  ]
                : [],
            )
            .filter(Boolean)}
        </List>
      </View>
    )
  }

  if (isLoading) {
    return <Spinner size="small" renderTitle={I18n.t('Loading')} />
  }

  return null
}
