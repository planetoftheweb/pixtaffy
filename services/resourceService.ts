import { db } from "./firebase";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  doc,
  deleteDoc,
  or,
  and,
  updateDoc
} from "firebase/firestore";
import { BrandColorDefinition, VisualStyleDefinition, GraphicTypeDefinition, AspectRatioDefinition } from "../types";
import { 
  BRAND_COLORS, 
  VISUAL_STYLES, 
  GRAPHIC_TYPES, 
  ASPECT_RATIOS 
} from "../constants";

// Helper to re-attach icons locally since we don't store them in DB
const attachIcon = (item: any, collection: any[]) => {
  const match = collection.find(c => c.id === item.id || c.value === item.value);
  return match ? { ...item, icon: match.icon } : item;
};

// Helper to fetch resources with complex scoping
// We want: 
// 1. scope == 'system' (Everyone)
// 2. scope == 'public' (Everyone)
// 3. scope == 'private' AND authorId == userId (My Private)
// 4. scope == 'team' AND teamId IN userTeamIds (My Teams)
const fetchScopedResources = async (
  collectionName: string, 
  userId?: string, 
  teamIds: string[] = []
) => {
  const ref = collection(db, collectionName);
  const results: any[] = [];
  
  // A. Fetch Public & System items (Global)
  // Note: Using 'in' for scope might be cleaner if indexes allow, 
  // but 'or' queries are often restricted. 
  // Safest: Query scopes separately or use a composite index.
  // Let's try simple queries merged in memory to avoid index explosion for this prototype.
  
  try {
      // 1. Global Items (System + Public)
      const globalQuery = query(ref, where("scope", "in", ["system", "public"]));
      const globalSnap = await getDocs(globalQuery);
      globalSnap.forEach(d => results.push({ ...d.data(), id: d.id }));

      if (userId) {
          // 2. Private Items
          const privateQuery = query(
              ref, 
              and(where("scope", "==", "private"), where("authorId", "==", userId))
          );
          const privateSnap = await getDocs(privateQuery);
          privateSnap.forEach(d => results.push({ ...d.data(), id: d.id }));

          // 3. Team Items
          if (teamIds.length > 0) {
             // Firestore 'in' limit is 10. If user has > 10 teams, this breaks.
             // Taking first 10 for safety.
             const safeTeamIds = teamIds.slice(0, 10);
             const teamQuery = query(
                 ref,
                 and(where("scope", "==", "team"), where("teamId", "in", safeTeamIds))
             );
             const teamSnap = await getDocs(teamQuery);
             teamSnap.forEach(d => results.push({ ...d.data(), id: d.id }));
          }
      }
      
      // Remove duplicates (in case of overlap, though scopes should be mutually exclusive)
      const uniqueResults = Array.from(new Map(results.map(item => [item.id, item])).values());
      return uniqueResults;

  } catch (e) {
      console.error(`Error fetching scoped resources for ${collectionName}:`, e);
      return [];
  }
};

export const resourceService = {
  
  getAllResources: async (userId?: string, teamIds: string[] = []) => {
    try {
      // 1. Graphic Types
      const dbTypes = await fetchScopedResources("graphic_types", userId, teamIds);
      let graphicTypes = dbTypes.map(d => attachIcon(d, GRAPHIC_TYPES));
      if (graphicTypes.length === 0) graphicTypes = GRAPHIC_TYPES; // Fallback

      // 2. Aspect Ratios
      const dbRatios = await fetchScopedResources("aspect_ratios", userId, teamIds);
      let aspectRatios = dbRatios.map(d => attachIcon(d, ASPECT_RATIOS));
      if (aspectRatios.length === 0) aspectRatios = ASPECT_RATIOS; // Fallback

      // 3. Visual Styles
      const dbStyles = await fetchScopedResources("visual_styles", userId, teamIds);
      const visualStyles = dbStyles.map(d => attachIcon(d, VISUAL_STYLES));
      
      // 4. Brand Colors
      const dbColors = await fetchScopedResources("brand_colors", userId, teamIds);
      const brandColors = dbColors.map(d => attachIcon(d, BRAND_COLORS));

      return {
        graphicTypes: graphicTypes as GraphicTypeDefinition[],
        aspectRatios: aspectRatios as AspectRatioDefinition[],
        visualStyles: visualStyles as VisualStyleDefinition[],
        brandColors: brandColors as BrandColorDefinition[]
      };

    } catch (error) {
      console.error("Error fetching resources:", error);
      // Fallback to constants
      return {
        graphicTypes: GRAPHIC_TYPES,
        aspectRatios: ASPECT_RATIOS,
        visualStyles: VISUAL_STYLES,
        brandColors: BRAND_COLORS
      };
    }
  },

  addCustomItem: async (collectionName: string, item: any, userId: string, scope: 'private'|'public'|'team' = 'private', teamId?: string) => {
    try {
      const docRef = await addDoc(collection(db, collectionName), {
        ...item,
        scope, 
        teamId: scope === 'team' ? teamId : null,
        authorId: userId,
        // Ensure legacy fields don't break things
        isSystem: false, 
        createdAt: Date.now(),
        votes: 0,
        voters: []
      });
      return { ...item, id: docRef.id, scope };
    } catch (error) {
      console.error(`Error adding to ${collectionName}:`, error);
      throw error;
    }
  },

  updateCustomItem: async (collectionName: string, itemId: string, item: any) => {
    try {
      const docRef = doc(db, collectionName, itemId);
      await updateDoc(docRef, item);
      return { ...item, id: itemId };
    } catch (error) {
      console.error(`Error updating ${collectionName}:`, error);
      throw error;
    }
  },

  deleteCustomItem: async (collectionName: string, itemId: string) => {
    try {
        await deleteDoc(doc(db, collectionName, itemId));
    } catch (error) {
        console.error(`Error deleting from ${collectionName}:`, error);
        throw error;
    }
  }
};
