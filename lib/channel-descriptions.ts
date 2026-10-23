import type {Room} from './chat-types';
const descriptions:Record<string,string>={
 'announcements':'Important team news and updates.',
 'complaint-department':'Raise a concern or suggest a way we can improve.',
 'daily-fair-operations':'Daily plans, setup details and fair updates.',
 'drivers':'Trips, routes and driver updates.',
 'innovations-and-ideas':'Share ideas to make our work better.',
 'maintenance':'Report equipment problems and keep repairs moving.',
 'management':'Plans, decisions and updates for managers.',
 'open-pms-chat':'Say hello, ask questions and chat with the crew.',
 'parts-request':'Ask for parts and check on supplies.',
 'projects':'Plan projects and share progress.',
 'rides':'Ride setup, operations and equipment updates.',
 'shop-crew':'Shop jobs, repairs and team updates.',
 'ticket-sellers':'Ticket booth updates and help for the sales team.',
 'tickets':'Ticket questions, counts and updates.'
};
export function channelDescription(room:Room){return descriptions[room.name.trim().toLowerCase()]||room.description||'Share updates and ask your team questions.';}
