import { useCallback, useEffect, useRef } from 'react'
import socket from '@/client'
import ACTIONS from '@/models/socket-actions'
import useStateWithCallback from './useStateWithCallback'
import freeice from 'freeice'

export const LOCAL_VIDEO = 'LOCAL_VIDEO'

export default function useWebRTC(roomID) {
  const [clients, setClients] = useStateWithCallback([])
  const peerConnections = useRef({})
  const localMediaStream = useRef(null)
  const peerMediaElements = useRef({
    [LOCAL_VIDEO]: null,
  })

  const addNewClient = useCallback(
    (newClient, cb) => {
      if (!clients.includes(newClient)) {
        setClients(list => [...list, newClient], cb)
      }
    },
    [clients, setClients],
  )

  useEffect(() => {
    async function handleNewPeer({ peerID, createOffer }) {
      if (peerID in peerConnections.current) {
        return console.warn(`Already connected to peer ${peerID}`)
      }

      peerConnections.current[peerID] = new RTCPeerConnection({
        iceServers: freeice(),
      })

      peerConnections.current[peerID].onicecandidate = event => {
        if (event.candidate) {
          socket.emit(ACTIONS.RELAY_ICE, {
            peerID,
            iceCandidate: event.candidate,
          })
        }
      }

      let numberTracks = 0
      peerConnections.current[peerID].ontrack = ({ streams: [remoteStream] }) => {
        numberTracks++

        if (numberTracks === 2) {
          addNewClient(peerID, () => {
            peerMediaElements.current[peerID].srcObject = remoteStream
          })
        }
      }

      localMediaStream.current.getTracks().forEach(t => {
        peerConnections.current[peerID].addTrack(t, localMediaStream.current)
      })

      if (createOffer) {
        const offer = await peerConnections.current[peerID].createOffer()

        await peerConnections.current[peerID].setLocalDescription(offer)

        socket.emit(ACTIONS.RELAY_SDP, {
          peerID,
          sessionDescription: offer,
        })
      }
    }

    socket.on(ACTIONS.ADD_PEER, handleNewPeer)
  }, [])

  useEffect(() => {
    async function setRemoteMedia({ peerID, sessionDescription: remoteDescription }) {
      await peerConnections.current[peerID].setRemoteDescription(
        new RTCSessionDescription(remoteDescription),
      )

      if (remoteDescription.type === 'offer') {
        const answer = await peerConnections.current[peerID].createAnswer()

        await peerConnections.current[peerID].setLocalDescription(answer)

        socket.emit(ACTIONS.RELAY_SDP, {
          peerID,
          sessionDescription: answer,
        })
      }
    }

    socket.on(ACTIONS.SESSION_DESCRIPTION, setRemoteMedia)
  }, [])

  useEffect(() => {
    socket.on(ACTIONS.ICE_CANDIDATE, ({ peerID, iceCandidate }) => {
      peerConnections.current[peerID].addIceCandidate(new RTCIceCandidate(iceCandidate))
    })
  }, [])

  useEffect(() => {
    socket.on(ACTIONS.REMOVE_PEER, ({ peerID }) => {
      if (peerConnections.current[peerID]) {
        peerConnections.current[peerID].close()
      }

      delete peerConnections.current[peerID]
      delete peerMediaElements.current[peerID]

      setClients(list => list.filter(c => c !== peerID))
    })
  }, [])

  useEffect(() => {
    async function startCapture() {
      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: 1280,
          height: 720,
        },
      })

      addNewClient(LOCAL_VIDEO, () => {
        const localVideoElement = peerMediaElements.current[LOCAL_VIDEO]

        if (localVideoElement) {
          localVideoElement.volume = 0
          localVideoElement.srcObject = localMediaStream.current
        }
      })
    }

    startCapture()
      .then(() =>
        socket.emit(ACTIONS.JOIN, {
          room: roomID,
        }),
      )
      .catch(e => {
        console.error('Error getting useMedia: ', e)
      })

    return () => {
      localMediaStream.current.getTracks().forEach(t => t.stop())

      socket.emit(ACTIONS.LEAVE)
    }
  }, [roomID])

  const provideMediaRef = useCallback((id, node) => {
    peerMediaElements.current[id] = node
  }, [])

  return { clients, provideMediaRef }
}
