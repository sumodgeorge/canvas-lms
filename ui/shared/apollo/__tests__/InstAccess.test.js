/*
 * Copyright (C) 2021 - present Instructure, Inc.
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

import InstAccess from '../InstAccess'

describe('InstAccess', () => {
  describe('initialization', () => {
    it('initializes with no token', () => {
      const ia = new InstAccess()
      expect(ia.instAccessToken).toBeNull()
    })

    it('can be provided a token if we have one available', () => {
      const ia = new InstAccess({token: 'veryFakeToken'})
      expect(ia.instAccessToken).toEqual('veryFakeToken')
    })
  })

  describe('token fetching', () => {
    it('will use a provided token if available', async () => {
      let invocationCount = 0
      const fakeFetch = async (uri, options) => {
        invocationCount += 1
        expect(uri).toEqual('http://fake-gateway/graphql')
        expect(options.headers.authorization).toEqual('Bearer veryFakeToken')
        return {
          status: 200
        }
      }
      const ia = new InstAccess({
        token: 'veryFakeToken',
        preferredFetch: fakeFetch
      })
      await ia.gatewayAuthenticatedFetch('http://fake-gateway/graphql', {})
      expect(invocationCount).toEqual(1)
    })

    it('fetches a token (with CSRF protection) when it needs one', async () => {
      let invocationCount = 0
      const fakeFetch = async (uri, options) => {
        invocationCount += 1
        if (uri === '/api/v1/inst_access_tokens') {
          expect(options.headers['X-CSRF-Token']).toEqual('myVerySafeCsrfToken')
          return {
            status: 200,
            json: () => {
              return {token: 'canvasProvidedToken'}
            }
          }
        }
        expect(uri).toEqual('http://fake-gateway/graphql')
        expect(options.headers.authorization).toEqual('Bearer canvasProvidedToken')
        return {
          status: 200
        }
      }
      const fakeDoc = {
        cookie: '_csrf_token=myVerySafeCsrfToken;some_other_key=someOtherValue'
      }
      const ia = new InstAccess({
        preferredFetch: fakeFetch,
        preferredDocument: fakeDoc
      })
      await ia.gatewayAuthenticatedFetch('http://fake-gateway/graphql', {})
      expect(invocationCount).toEqual(2)
    })

    it('refreshes token when expired', async () => {
      let invocationCount = 0
      const fakeFetch = async (uri, options) => {
        invocationCount += 1
        if (uri === '/api/v1/inst_access_tokens') {
          expect(options.headers['X-CSRF-Token']).toEqual('myVerySafeCsrfToken')
          return {
            status: 200,
            json: () => {
              return {token: 'freshCanvasProvidedToken'}
            }
          }
        }
        expect(uri).toEqual('http://fake-gateway/graphql')
        let statusCode = 401
        if (options.headers.authorization === 'Bearer freshCanvasProvidedToken') {
          // if it uses the provided expired token, it should fail here, and won't get a 200
          // until it refreshes and comes back with a new token
          statusCode = 200
        }
        return {status: statusCode}
      }
      const fakeDoc = {
        cookie: '_csrf_token=myVerySafeCsrfToken;some_other_key=someOtherValue'
      }
      const ia = new InstAccess({
        token: 'ExistingToken',
        preferredFetch: fakeFetch,
        preferredDocument: fakeDoc
      })
      const finalResponse = await ia.gatewayAuthenticatedFetch('http://fake-gateway/graphql', {})
      expect(finalResponse.status).toEqual(200)
      expect(invocationCount).toEqual(3)
    })
  })
})
